import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../../db/migrate.js";
import { recentChangelog } from "../../audit/audit.js";
import type { GitHubClient } from "../../github/client.js";
import { buildReviewPrompt, MICRO_DEFENSE_QUESTION, POLICY_VERSION, REVIEW_SCHEMA } from "./prompt.js";
import { microDefenseStatus, MICRO_DEFENSE_MARKER } from "./microdefense.js";
import { reviewPullRequest, LLM_REVIEW_MARKER } from "./reviewer.js";
import type { LlmClient, LlmReviewRequest } from "./anthropic.js";
import { runActions, llmReviewEnabled } from "../actions.js";
import { DEFAULT_CONFIG, parseStewardConfig, type StewardConfig } from "../stewardConfig.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

// A GitHubClient that records calls. Same shape as the M2 fake — proves the
// reviewer only ever uses safe, additive operations.
class FakeClient implements GitHubClient {
  calls: Array<{ m: string; args: unknown[] }> = [];
  files: unknown = [];
  comments: Array<{ id: number; body: string }> = []; // pre-existing PR comments
  private rec<T>(m: string, args: unknown[], ret: T): Promise<T> { this.calls.push({ m, args }); return Promise.resolve(ret); }
  getPullRequestFiles(...a: any[]) { this.calls.push({ m: "getPullRequestFiles", args: a }); return Promise.resolve(this.files); }
  listIssueComments(...a: any[]) { this.calls.push({ m: "listIssueComments", args: a }); return Promise.resolve(this.comments); }
  updateIssueComment(...a: any[]) { return this.rec("updateIssueComment", a, {}); }
  listPullRequestReviews(...a: any[]) { return this.rec("listPullRequestReviews", a, []); }
  listCheckRunsForRef(...a: any[]) { return this.rec("listCheckRunsForRef", a, { check_runs: [] }); }
  getBranch(...a: any[]) { return this.rec("getBranch", a, {}); }
  getBranchProtection(...a: any[]) { return this.rec("getBranchProtection", a, null); }
  listCommits(...a: any[]) { return this.rec("listCommits", a, []); }
  listInstallationRepositories(...a: any[]) { return this.rec("listInstallationRepositories", a, [] as any); }
  createBranch(...a: any[]) { return this.rec("createBranch", a, {}); }
  openDraftPullRequest(...a: any[]) { return this.rec("openDraftPullRequest", a, {}); }
  createReviewComment(...a: any[]) { return this.rec("createReviewComment", a, {}); }
  createCommitComment(...a: any[]) { return this.rec("createCommitComment", a, {}); }
  createCheckRun(...a: any[]) { return this.rec("createCheckRun", a, {}); }
  setBranchProtection(...a: any[]) { return this.rec("setBranchProtection", a, {}); }
  names() { return this.calls.map((c) => c.m); }
  lastComment() { return this.calls.find((c) => c.m === "createReviewComment")?.args[2] as string | undefined; }
}

// A fake LLM: records the request it was handed, returns a canned review.
class FakeLlm implements LlmClient {
  seen: LlmReviewRequest | null = null;
  constructor(private ret: unknown) {}
  review(req: LlmReviewRequest) { this.seen = req; return Promise.resolve(this.ret); }
}

const GATING = /setBranchProtection|createCheckRun/; // the two ways it could gate

afterAll(async () => { await pool.end(); });

describe("M3 prompt assembly", () => {
  it("bakes the policy and the advise-never-gate doctrine into the system prompt", () => {
    const p = buildReviewPrompt({ repo: "acme/app", number: 1, title: "t", body: "b", files: [{ filename: "a.ts", patch: "@@ +1 @@\n+x" }] });
    expect(p.system).toMatch(/never gate/i);
    expect(p.system).toMatch(/every finding must cite/i);
    // a genuine model-judgment policy row is present
    expect(p.system).toMatch(/duplicates|contract|micro|auth/i);
    // the user turn carries the diff
    expect(p.user).toContain("a.ts");
    expect(p.truncated).toBe(false);
  });

  it("caps a huge diff and flags that it was truncated", () => {
    const big = "+".repeat(200_000);
    const p = buildReviewPrompt({ repo: "acme/app", number: 2, title: null, body: null, files: [{ filename: "big.ts", patch: big }, { filename: "b.ts", patch: "+y" }] });
    expect(p.truncated).toBe(true);
    expect(p.user.length).toBeLessThan(120_000); // bounded, not the raw 200k
  });

  it("the review schema requires evidence on every finding", () => {
    const items = (REVIEW_SCHEMA as any).properties.findings.items;
    expect(items.required).toContain("file");
    expect(items.required).toContain("lines");
    expect(items.required).toContain("rationale");
  });
});

describe("M3 reviewer — advises, never gates", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });

  it("posts exactly one comment, cites evidence, discloses data-flow, never gates, and logs", async () => {
    const c = new FakeClient();
    c.files = [{ filename: "routes/orders.ts", patch: "@@ +40,8 @@\n+app.post('/refund', h)" }];
    const llm = new FakeLlm({
      summary: "Adds a refund route that skips the auth its siblings use.",
      findings: [{ area: "Security", title: "Route missing auth", file: "routes/orders.ts", lines: "40-48", rationale: "Every other order route checks a key; this one doesn't." }],
    });

    const out = await reviewPullRequest(c, llm, pool, { repo: "acme/app", number: 14, title: "Refunds", body: "", headSha: "deadbeef", author: "dana", installationId: 7 });

    expect(out.posted).toBe(true);
    expect(out.findingCount).toBe(1);
    // exactly one comment, and it never gated
    expect(c.names().filter((n) => n === "createReviewComment")).toHaveLength(1);
    expect(c.names().filter((n) => GATING.test(n))).toEqual([]);

    const body = c.lastComment()!;
    expect(body).toContain(LLM_REVIEW_MARKER);
    expect(body).toMatch(/advice, not a gate/i);
    expect(body).toMatch(/doesn't block anything/i);
    expect(body).toContain("routes/orders.ts"); // cited file
    expect(body).toContain("40-48"); // cited lines
    expect(body).toMatch(/third-party AI model/i); // data-flow disclosure
    expect(body).toContain(MICRO_DEFENSE_QUESTION); // micro-defense asked
    expect(body).toContain(MICRO_DEFENSE_MARKER);

    // logged as advisory
    const log = await recentChangelog(pool, { repo: "acme/app" });
    expect(log[0]!.event_type).toBe("llm.reviewed");
    expect(log[0]!.plain_english).toMatch(/nothing was blocked/i);
  });

  it("handles a clean change: empty findings, still one comment, still no gate", async () => {
    const c = new FakeClient();
    const llm = new FakeLlm({ summary: "Looks fine.", findings: [] });
    const out = await reviewPullRequest(c, llm, pool, { repo: "acme/app", number: 9, title: "docs", body: "", headSha: null, author: "raj", installationId: 7 });
    expect(out.findingCount).toBe(0);
    expect(c.lastComment()).toMatch(/Nothing stood out/i);
    expect(c.names().filter((n) => GATING.test(n))).toEqual([]);
  });
});

describe("M3 opt-in guard", () => {
  it("only runs when repo AND operator both opt in", () => {
    const on: StewardConfig = { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, enabled: true } };
    const off = DEFAULT_CONFIG; // llm.enabled false
    expect(llmReviewEnabled(on, true)).toBe(true);
    expect(llmReviewEnabled(on, false)).toBe(false); // operator off
    expect(llmReviewEnabled(off, true)).toBe(false); // repo off
    expect(llmReviewEnabled(off, false)).toBe(false);
  });

  it("actions runs the review when opted in, and skips it when the repo hasn't", async () => {
    await migrate(url); await pool.query("TRUNCATE audit_events");
    const prPayload = { action: "opened", repository: { full_name: "acme/app", default_branch: "main" }, installation: { id: 7 }, pull_request: { number: 3, title: "x", body: "", head: { sha: "abc" }, user: { login: "dana" } } };

    // repo opted OUT -> no review posted
    const cOff = new FakeClient();
    const llmOff = new FakeLlm({ summary: "s", findings: [] });
    await runActions(pool, "pull_request", prPayload, { client: cOff, llm: llmOff, config: DEFAULT_CONFIG });
    expect(cOff.names()).not.toContain("createReviewComment");
    expect(llmOff.seen).toBeNull(); // model never called

    // repo opted IN -> review posted (injected llm stands in for operator opt-in)
    const cOn = new FakeClient();
    const llmOn = new FakeLlm({ summary: "s", findings: [] });
    await runActions(pool, "pull_request", prPayload, { client: cOn, llm: llmOn, config: { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm, enabled: true } } });
    expect(cOn.names()).toContain("createReviewComment");
    expect(llmOn.seen).not.toBeNull();
    expect(cOn.names().filter((n) => GATING.test(n))).toEqual([]);
  });
});

describe("M3 noise & spend discipline — sticky comment, idempotency, cap", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });

  const ctx = (headSha: string, extra: Partial<Parameters<typeof reviewPullRequest>[3]> = {}) =>
    ({ repo: "acme/app", number: 21, title: "t", body: "", headSha, author: "dana", installationId: 7, ...extra });

  it("updates its own existing comment in place instead of posting a second one", async () => {
    const c = new FakeClient();
    c.comments = [
      { id: 900, body: "a human comment" },
      { id: 901, body: `${LLM_REVIEW_MARKER}\nolder review` },
    ];
    const llm = new FakeLlm({ summary: "s", findings: [] });

    const out = await reviewPullRequest(c, llm, pool, ctx("sha-2"));
    expect(out.posted).toBe(true);
    // updated ours (id 901), never created a new one, never touched the human's
    expect(c.names()).toContain("updateIssueComment");
    expect(c.names()).not.toContain("createReviewComment");
    const upd = c.calls.find((x) => x.m === "updateIssueComment")!;
    expect(upd.args[1]).toBe(901);
  });

  it("never reviews the same head SHA twice (webhook redelivery is free)", async () => {
    const c = new FakeClient();
    const llm = new FakeLlm({ summary: "s", findings: [] });
    const first = await reviewPullRequest(c, llm, pool, ctx("sha-same"));
    expect(first.posted).toBe(true);

    const c2 = new FakeClient();
    const llm2 = new FakeLlm({ summary: "s", findings: [] });
    const second = await reviewPullRequest(c2, llm2, pool, ctx("sha-same"));
    expect(second.posted).toBe(false);
    expect(second.skipped).toBe("already_reviewed");
    expect(llm2.seen).toBeNull(); // the model was never called — no spend
    expect(c2.names()).not.toContain("createReviewComment");
  });

  it("caps reviews per PR, logs the pause exactly once, and stays quiet after", async () => {
    // two reviews allowed; third and fourth pushes must not spend or post
    for (let i = 1; i <= 2; i++) {
      const out = await reviewPullRequest(new FakeClient(), new FakeLlm({ summary: "s", findings: [] }), pool, ctx(`sha-${i}`, { maxReviewsPerPr: 2 }));
      expect(out.posted).toBe(true);
    }
    for (const sha of ["sha-3", "sha-4"]) {
      const llm = new FakeLlm({ summary: "s", findings: [] });
      const out = await reviewPullRequest(new FakeClient(), llm, pool, ctx(sha, { maxReviewsPerPr: 2 }));
      expect(out.posted).toBe(false);
      expect(out.skipped).toBe("capped");
      expect(llm.seen).toBeNull();
    }
    // the pause is in the audit log ONCE, in plain language
    const capped = await pool.query("SELECT plain_english FROM audit_events WHERE event_type = 'llm.review_capped'");
    expect(capped.rows).toHaveLength(1);
    expect(capped.rows[0].plain_english).toMatch(/paused/i);
    expect(capped.rows[0].plain_english).toMatch(/safety checks still run/i);
  });

  it("records provenance — policy version, model, prompt hash, finding facts — in the audit payload", async () => {
    const c = new FakeClient();
    const llm = new FakeLlm({
      summary: "s",
      findings: [{ area: "Security", title: "Route missing auth", file: "routes/x.ts", lines: "4-9", rationale: "why" }],
    });
    await reviewPullRequest(c, llm, pool, ctx("sha-prov"));

    const row = (await pool.query("SELECT payload FROM audit_events WHERE event_type = 'llm.reviewed'")).rows[0];
    const p = row.payload;
    expect(p.provenance.policyVersion).toBe(POLICY_VERSION);
    expect(p.provenance.policyVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(p.provenance.model).toBe("unknown"); // FakeLlm declares no model
    expect(p.provenance.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    // finding FACTS are in the spine (citable), the prose stays in the comment
    expect(p.findings).toEqual([{ area: "Security", title: "Route missing auth", file: "routes/x.ts", lines: "4-9" }]);
    expect(p.reviewNumber).toBe(1);

    // and the comment footer pins the same provenance for the human
    const body = c.lastComment()!;
    expect(body).toContain(POLICY_VERSION);
    expect(body).toMatch(/Review 1 of 5/);
  });

  it("parses llm.max_reviews_per_pr from .steward.yml with clamping", () => {
    expect(parseStewardConfig("llm:\n  enabled: true\n  max_reviews_per_pr: 3").llm.maxReviewsPerPr).toBe(3);
    expect(parseStewardConfig("llm:\n  max_reviews_per_pr: 0").llm.maxReviewsPerPr).toBe(1); // clamped up
    expect(parseStewardConfig("llm:\n  max_reviews_per_pr: 999").llm.maxReviewsPerPr).toBe(20); // clamped down
    expect(parseStewardConfig("").llm.maxReviewsPerPr).toBe(5); // default
  });
});

describe("M3 micro-defense — presence only, never scored", () => {
  it("is unanswered until the PR author replies after the question", () => {
    const asked = { author: "codeworthy-steward", body: `hello ${MICRO_DEFENSE_MARKER}` };
    expect(microDefenseStatus("dana", [asked]).answered).toBe(false);
    // someone else replies -> still not answered
    expect(microDefenseStatus("dana", [asked, { author: "raj", body: "looks good" }]).answered).toBe(false);
    // the author replies -> answered, and we keep their words verbatim
    const done = microDefenseStatus("dana", [asked, { author: "dana", body: "Adds refunds; the risk is double-refunding." }]);
    expect(done.answered).toBe(true);
    expect(done.answer).toContain("double-refunding");
  });
});
