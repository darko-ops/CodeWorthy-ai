import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFindings, renderReviewBody, runAdviseReview, buildPrompt, AI_REVIEW_CHECK } from "../src/llm.mjs";

test("parseFindings: valid JSON, junk, and non-arrays", () => {
  const good = parseFindings(
    'Here you go: [{"finding":"Route /export lacks the ops-key its siblings check.","policy_row":"security/missing-auth-sibling","evidence":"src/routes/orders.ts /export"}]'
  );
  assert.equal(good.length, 1);
  assert.equal(good[0].policy_row, "security/missing-auth-sibling");
  assert.deepEqual(parseFindings("no json at all"), []);
  assert.deepEqual(parseFindings('{"finding":"x"}'), []);
  assert.deepEqual(parseFindings("[1,2,3]"), []);
});

test("prompt embeds the policy and the diff", () => {
  const messages = buildPrompt({ diff: "diff --git a/x b/x", prTitle: "T", prBody: "B" });
  assert.match(messages[0].content, /never block/i);
  assert.match(messages[1].content, /diff --git/);
});

test("review body always states it is advisory", () => {
  assert.match(renderReviewBody([]), /never|advisory/i);
  assert.match(
    renderReviewBody([{ finding: "f", policy_row: "p", evidence: "e" }]),
    /never blocks a merge/i
  );
});

function stubClient() {
  const calls = [];
  const rec = (name, ret) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(ret);
  };
  return {
    calls,
    getPullDiff: rec("getPullDiff", "diff --git a/x b/x"),
    createReview: rec("createReview", {}),
    createCheckRun: rec("createCheckRun", { id: 1 }),
  };
}

const basePr = { number: 9, title: "T", body: "B", head: { sha: "d".repeat(40) } };
const auditNoop = async () => ({});

test("advise review posts neutral check on success", async () => {
  const client = stubClient();
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ content: [{ text: "[]" }] }),
  });
  const result = await runAdviseReview({
    client, audit: auditNoop, owner: "a", repo: "b", repoFull: "a/b",
    installationId: 1, pr: basePr, env: { ANTHROPIC_API_KEY: "k" }, fetchImpl,
  });
  const check = client.calls.find((c) => c.name === "createCheckRun");
  assert.equal(check.args[2].name, AI_REVIEW_CHECK);
  assert.equal(check.args[2].conclusion, "neutral");
  assert.equal(result.conclusion, "neutral");
});

test("advise review stays neutral even when the model call fails", async () => {
  const client = stubClient();
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const result = await runAdviseReview({
    client, audit: auditNoop, owner: "a", repo: "b", repoFull: "a/b",
    installationId: 1, pr: basePr, env: { ANTHROPIC_API_KEY: "k" }, fetchImpl,
  });
  const check = client.calls.find((c) => c.name === "createCheckRun");
  assert.equal(check.args[2].conclusion, "neutral", "an AI failure must never block anyone");
  assert.equal(result.findings, 0);
});
