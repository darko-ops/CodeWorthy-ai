import { test } from "node:test";
import assert from "node:assert/strict";
import { handlePush } from "../src/handlers/push.mjs";
import { handlePullRequest, handleIssueComment } from "../src/handlers/pullRequest.mjs";
import { parseStewardConfig, DEFAULTS, protectionPayload } from "../src/policy.mjs";
import { verifyWebhookSignature } from "../src/github.mjs";
import { createHmac } from "node:crypto";

// A recording stub for the client surface handlers use.
function stubClient(overrides = {}) {
  const calls = [];
  const record = (name, ret) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(typeof ret === "function" ? ret(...args) : ret);
  };
  return {
    calls,
    getFileContent: record("getFileContent", overrides.stewardYml ?? null),
    createRef: record("createRef", {}),
    createCommitComment: record("createCommitComment", {}),
    createDraftPull: record("createDraftPull", { number: 7 }),
    listPullsForBranch: record("listPullsForBranch", overrides.openPulls ?? []),
    getBranchProtection: record("getBranchProtection", overrides.protection ?? null),
    applyBranchProtection: record("applyBranchProtection", {}),
    updatePullBody: record("updatePullBody", {}),
    createIssueComment: record("createIssueComment", {}),
    createCheckRun: record("createCheckRun", { id: 42 }),
    updateCheckRun: record("updateCheckRun", {}),
    createReview: record("createReview", {}),
    getPullDiff: record("getPullDiff", "diff --git a/x b/x"),
  };
}

function brokerFor(client) {
  return { clientFor: async () => client };
}

function auditRecorder() {
  const events = [];
  const audit = async (e) => {
    events.push(e);
    return { id: events.length };
  };
  audit.events = events;
  return audit;
}

const pushPayload = (overrides = {}) => ({
  ref: "refs/heads/main",
  before: "a".repeat(40),
  after: "b".repeat(40),
  deleted: false,
  commits: [{ message: "quick fix", added: [], modified: ["src/app.ts"], removed: [] }],
  pusher: { name: "dana" },
  sender: { login: "dana", type: "User" },
  repository: { full_name: "acme/shop", default_branch: "main" },
  installation: { id: 11 },
  ...overrides,
});

test("push to default branch: restore point + coaching + audit, no destructive call", async () => {
  const client = stubClient();
  const audit = auditRecorder();
  const result = await handlePush({ payload: pushPayload(), broker: brokerFor(client), audit });

  assert.equal(result.action, "default_branch_coaching");
  const refCall = client.calls.find((c) => c.name === "createRef");
  assert.ok(refCall, "restore-point branch created");
  assert.match(refCall.args[2], /^steward\/restore-/);
  assert.equal(refCall.args[3], "a".repeat(40), "restore point is the PRE-push head");
  assert.ok(client.calls.some((c) => c.name === "createCommitComment"));
  assert.equal(audit.events[0].eventType, "direct_push_to_default");
  // No protection without consent:
  assert.ok(!client.calls.some((c) => c.name === "applyBranchProtection"));
});

test("push to default branch with protect consent applies protection and logs it", async () => {
  const client = stubClient({ stewardYml: "protect: true\n" });
  const audit = auditRecorder();
  await handlePush({ payload: pushPayload(), broker: brokerFor(client), audit });
  assert.ok(client.calls.some((c) => c.name === "applyBranchProtection"));
  assert.ok(audit.events.some((e) => e.eventType === "protection_applied"));
});

test("branch push with no open PR gets a draft PR", async () => {
  const client = stubClient();
  const audit = auditRecorder();
  const result = await handlePush({
    payload: pushPayload({ ref: "refs/heads/feature-x" }),
    broker: brokerFor(client),
    audit,
  });
  assert.equal(result.action, "draft_pr_created");
  const draft = client.calls.find((c) => c.name === "createDraftPull");
  assert.equal(draft.args[2].base, "main");
  assert.equal(draft.args[2].head, "feature-x");
  assert.ok(audit.events.some((e) => e.eventType === "draft_pr_created"));
});

test("branch push with an open PR does nothing", async () => {
  const client = stubClient({ openPulls: [{ number: 3 }] });
  const result = await handlePush({
    payload: pushPayload({ ref: "refs/heads/feature-x" }),
    broker: brokerFor(client),
    audit: auditRecorder(),
  });
  assert.equal(result.skipped, "PR already open");
});

test("bot pushes and steward branches are ignored", async () => {
  const client = stubClient();
  const botResult = await handlePush({
    payload: pushPayload({ sender: { login: "steward[bot]", type: "Bot" } }),
    broker: brokerFor(client),
    audit: auditRecorder(),
  });
  assert.equal(botResult.skipped, "bot push");
  const houseResult = await handlePush({
    payload: pushPayload({ ref: "refs/heads/steward/restore-abc1234" }),
    broker: brokerFor(client),
    audit: auditRecorder(),
  });
  assert.equal(houseResult.skipped, "steward housekeeping branch");
});

const prPayload = (overrides = {}) => ({
  action: "opened",
  pull_request: {
    number: 5,
    title: "Add export",
    body: "",
    draft: false,
    additions: 300,
    deletions: 20,
    user: { login: "dana", type: "User" },
    head: { sha: "c".repeat(40) },
  },
  repository: { full_name: "acme/shop", default_branch: "main" },
  installation: { id: 11 },
  ...overrides,
});

test("empty PR description gets a draft; micro-defense asked above threshold", async () => {
  const client = stubClient();
  const audit = auditRecorder();
  const result = await handlePullRequest({
    payload: prPayload(),
    broker: brokerFor(client),
    audit,
    env: {},
  });
  assert.equal(result.descriptionDrafted, true);
  assert.ok(result.microDefense);
  const check = client.calls.find((c) => c.name === "createCheckRun");
  assert.equal(check.args[2].name, "steward/micro-defense");
});

test("small PR skips the micro-defense", async () => {
  const client = stubClient();
  const result = await handlePullRequest({
    payload: prPayload({
      pull_request: { ...prPayload().pull_request, additions: 5, deletions: 1, body: "done" },
    }),
    broker: brokerFor(client),
    audit: auditRecorder(),
    env: {},
  });
  assert.ok(!result.microDefense);
  assert.ok(!result.descriptionDrafted);
});

test("micro-defense turns green when a human answers", async () => {
  const client = stubClient();
  const audit = auditRecorder();
  const pending = new Map([["acme/shop#5", 42]]);
  const result = await handleIssueComment({
    payload: {
      action: "created",
      comment: { user: { login: "dana", type: "User" }, body: "It exports orders; CSV escaping could break." },
      issue: { number: 5, pull_request: {} },
      repository: { full_name: "acme/shop" },
      installation: { id: 11 },
    },
    broker: brokerFor(client),
    audit,
    pending,
  });
  assert.equal(result.completed, true);
  const update = client.calls.find((c) => c.name === "updateCheckRun");
  assert.equal(update.args[3].conclusion, "success");
  assert.equal(pending.size, 0);
});

test("LLM review does not run without both the server flag and repo consent", async () => {
  const client = stubClient();
  const result = await handlePullRequest({
    payload: prPayload(),
    broker: brokerFor(client),
    audit: auditRecorder(),
    env: { STEWARD_LLM: "1" }, // flag on, but repo config says no
  });
  assert.ok(!result.aiReview);
});

test("steward config parser: defaults, overrides, junk-tolerance", () => {
  assert.deepEqual(parseStewardConfig(null), DEFAULTS);
  const parsed = parseStewardConfig(
    "# comment\nprotect: true\nmicro_defense_threshold: 50\nunknown_key: whatever\nllm_review: maybe\n"
  );
  assert.equal(parsed.protect, true);
  assert.equal(parsed.micro_defense_threshold, 50);
  assert.equal(parsed.llm_review, false, "non-boolean value keeps the safe default");
  assert.ok(!("unknown_key" in parsed));
});

test("protection payload blocks force pushes and deletions, requires PRs, zero approvals", () => {
  const p = protectionPayload();
  assert.equal(p.allow_force_pushes, false);
  assert.equal(p.allow_deletions, false);
  assert.equal(p.required_pull_request_reviews.required_approving_review_count, 0);
});

test("webhook signature verification", () => {
  const secret = "s3cret";
  const body = Buffer.from('{"a":1}');
  const good = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhookSignature(secret, body, good), true);
  assert.equal(verifyWebhookSignature(secret, body, "sha256=deadbeef"), false);
  assert.equal(verifyWebhookSignature(secret, body, undefined), false);
});
