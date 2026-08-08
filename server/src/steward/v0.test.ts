// V0 evidence-model tests (docs/validator-build-plan.md): merge evidence keyed
// on the merge SHA (V0.2), the exception.* family (V0.3), and coverage windows
// (V0.4). Canonical v2 (V0.1) is covered in src/audit/canonical.test.ts.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { applyCoverageEvent, coverageFor } from "../audit/coverage.js";
import type { GitHubClient } from "../github/client.js";
import { runActions } from "./actions.js";
import { toStewardEvent } from "./events.js";
import { computeApprovers, recordMergeEvidence } from "./mergeEvidence.js";
import { runDriftCheck } from "./protection.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

class FakeClient implements GitHubClient {
  calls: Array<{ m: string; args: unknown[] }> = [];
  reviews: unknown = [];
  checkRuns: unknown = { check_runs: [] };
  protection: unknown = null;
  failReviews = false;
  private rec<T>(m: string, args: unknown[], ret: T): Promise<T> { this.calls.push({ m, args }); return Promise.resolve(ret); }
  getPullRequestFiles(...a: any[]) { return this.rec("getPullRequestFiles", a, []); }
  listIssueComments(...a: any[]) { return this.rec("listIssueComments", a, []); }
  listPullRequestReviews(...a: any[]) {
    this.calls.push({ m: "listPullRequestReviews", args: a });
    return this.failReviews ? Promise.reject(new Error("boom")) : Promise.resolve(this.reviews);
  }
  listPullRequests(...a: any[]) { return this.rec("listPullRequests", a, []); }
  listCheckRunsForRef(...a: any[]) { this.calls.push({ m: "listCheckRunsForRef", args: a }); return Promise.resolve(this.checkRuns); }
  getBranch(...a: any[]) { return this.rec("getBranch", a, {}); }
  getBranchProtection(...a: any[]) { this.calls.push({ m: "getBranchProtection", args: a }); return Promise.resolve(this.protection); }
  listCommits(...a: any[]) { return this.rec("listCommits", a, []); }
  listInstallationRepositories(...a: any[]) { return this.rec("listInstallationRepositories", a, [] as any); }
  createBranch(...a: any[]) { return this.rec("createBranch", a, {}); }
  openDraftPullRequest(...a: any[]) { return this.rec("openDraftPullRequest", a, {}); }
  createReviewComment(...a: any[]) { return this.rec("createReviewComment", a, {}); }
  updateIssueComment(...a: any[]) { return this.rec("updateIssueComment", a, {}); }
  createCommitComment(...a: any[]) { return this.rec("createCommitComment", a, {}); }
  createCheckRun(...a: any[]) { return this.rec("createCheckRun", a, {}); }
  setBranchProtection(...a: any[]) { return this.rec("setBranchProtection", a, {}); }
}

const events = async (type?: string) =>
  (await pool.query(
    type
      ? "SELECT event_type, actor, payload, plain_english FROM audit_events WHERE event_type = $1 ORDER BY id"
      : "SELECT event_type, actor, payload, plain_english FROM audit_events ORDER BY id",
    type ? [type] : []
  )).rows;

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await migrate(url);
  await pool.query("TRUNCATE audit_events");
  await pool.query("TRUNCATE coverage_windows");
});

describe("V0.2 — merge evidence keyed on the merge SHA", () => {
  const mergeCtx = {
    repo: "acme/app", number: 14, installationId: 7,
    author: "dana", mergedBy: "dana", mergedAt: "2026-08-08T12:00:00Z",
    mergeSha: "cafe1234deadbeef", headSha: "feed5678", base: "main",
  };

  it("records approvers, checks, and the join key; clean merge has no exception", async () => {
    const c = new FakeClient();
    c.reviews = [
      { user: { login: "raj" }, state: "APPROVED", submitted_at: "2026-08-08T11:00:00Z" },
      { user: { login: "mia" }, state: "COMMENTED", submitted_at: "2026-08-08T11:30:00Z" },
    ];
    c.checkRuns = { check_runs: [{ name: "ci", conclusion: "success" }, { name: "lint", conclusion: "neutral" }] };

    const { evidence } = await recordMergeEvidence(c, pool, mergeCtx);
    expect(evidence.approvers).toEqual([{ login: "raj", submittedAt: "2026-08-08T11:00:00Z" }]);
    expect(evidence.selfApproved).toBe(false);
    expect(evidence.approvalPrecededMerge).toBe(true);
    expect(evidence.redChecksAtMerge).toEqual([]);
    expect(evidence.evidenceGaps).toEqual([]);

    const [ev] = await events("change.merged");
    expect(ev.payload.mergeSha).toBe("cafe1234deadbeef"); // the join key
    expect(ev.payload.approvers).toHaveLength(1);
    expect(ev.plain_english).toMatch(/1 approval \(raj\)/);
    expect(ev.plain_english).toMatch(/all 2 checks passing/);
    expect(await events("exception.merged_red_checks")).toHaveLength(0);
  });

  it("flags self-approval and red checks — and appends the exception event", async () => {
    const c = new FakeClient();
    c.reviews = [{ user: { login: "dana" }, state: "APPROVED", submitted_at: "2026-08-08T11:00:00Z" }];
    c.checkRuns = { check_runs: [{ name: "ci", conclusion: "failure" }, { name: "lint", conclusion: "success" }] };

    const { evidence } = await recordMergeEvidence(c, pool, mergeCtx);
    expect(evidence.selfApproved).toBe(true);
    expect(evidence.redChecksAtMerge).toEqual(["ci"]);

    const [merged] = await events("change.merged");
    expect(merged.plain_english).toMatch(/including the author's own/);
    expect(merged.plain_english).toMatch(/1 of 2 checks FAILING at merge \(ci\)/);
    const [exc] = await events("exception.merged_red_checks");
    expect(exc.payload.redChecks).toEqual(["ci"]);
    expect(exc.plain_english).toMatch(/^Exception:/);
  });

  it("a later CHANGES_REQUESTED supersedes an earlier approval; post-merge approvals don't count", () => {
    const { approvers } = computeApprovers(
      [
        { user: { login: "raj" }, state: "APPROVED", submitted_at: "2026-08-08T10:00:00Z" },
        { user: { login: "raj" }, state: "CHANGES_REQUESTED", submitted_at: "2026-08-08T11:00:00Z" },
        { user: { login: "mia" }, state: "APPROVED", submitted_at: "2026-08-08T13:00:00Z" }, // after merge
      ],
      "2026-08-08T12:00:00Z",
      "dana"
    );
    expect(approvers).toEqual([]);
  });

  it("records evidence gaps instead of hiding an API failure", async () => {
    const c = new FakeClient();
    c.failReviews = true;
    const { evidence } = await recordMergeEvidence(c, pool, { ...mergeCtx, headSha: null });
    expect(evidence.evidenceGaps).toContain("reviews_unavailable");
    expect(evidence.evidenceGaps).toContain("head_sha_missing");
    const [ev] = await events("change.merged");
    expect(ev.payload.evidenceGaps).toEqual(["reviews_unavailable", "head_sha_missing"]);
    expect(ev.plain_english).toMatch(/check status could not be read/);
  });

  it("runActions gathers merge evidence on a merged-close webhook", async () => {
    const c = new FakeClient();
    c.reviews = [{ user: { login: "raj" }, state: "APPROVED", submitted_at: "2026-08-08T11:00:00Z" }];
    await runActions(pool, "pull_request", {
      action: "closed",
      repository: { full_name: "acme/app", default_branch: "main" },
      installation: { id: 7 },
      sender: { login: "dana" },
      pull_request: {
        number: 14, merged: true, merge_commit_sha: "cafe12", merged_at: "2026-08-08T12:00:00Z",
        user: { login: "dana" }, merged_by: { login: "dana" }, head: { sha: "feed56" }, base: { ref: "main" },
      },
    }, { client: c });
    expect((await events("change.merged"))).toHaveLength(1);
  });
});

describe("V0.3 — the exception family", () => {
  it("a force-push to the default branch is a first-class exception", () => {
    const ev = toStewardEvent("push", {
      ref: "refs/heads/main",
      forced: true,
      commits: [{}],
      after: "abc", before: "def",
      repository: { full_name: "acme/app", default_branch: "main" },
      pusher: { name: "dana" },
      installation: { id: 7 },
    })!;
    expect(ev.eventType).toBe("exception.force_push");
    expect(ev.plainEnglish).toMatch(/^Exception: dana force-pushed main/);
  });

  it("an ordinary direct push is still the attention-tier event, not an exception", () => {
    const ev = toStewardEvent("push", {
      ref: "refs/heads/main",
      commits: [{}, {}],
      after: "abc",
      repository: { full_name: "acme/app", default_branch: "main" },
      pusher: { name: "dana" },
    })!;
    expect(ev.eventType).toBe("push.direct_to_default");
  });

  it("weakened protection now lands as exception.protection_weakened", async () => {
    const c = new FakeClient();
    c.protection = { allow_force_pushes: { enabled: true } }; // drifted
    await runDriftCheck(c, pool, "acme/app", "main", 7);
    const rows = await events("exception.protection_weakened");
    expect(rows).toHaveLength(1);
    expect(rows[0].plain_english).toMatch(/^Exception: branch protection/);
  });
});

describe("V0.4 — coverage windows", () => {
  it("install opens windows; removing a repo closes only that repo's window", async () => {
    await applyCoverageEvent(pool, "installation", {
      action: "created",
      installation: { id: 7 },
      repositories: [{ full_name: "acme/app" }, { full_name: "acme/site" }],
    });
    expect((await coverageFor(pool, "acme/app"))[0]?.coveredTo).toBeNull();
    expect((await coverageFor(pool, "acme/site"))[0]?.coveredTo).toBeNull();

    await applyCoverageEvent(pool, "installation_repositories", {
      installation: { id: 7 },
      repositories_removed: [{ full_name: "acme/site" }],
    });
    expect((await coverageFor(pool, "acme/site"))[0]?.coveredTo).not.toBeNull();
    expect((await coverageFor(pool, "acme/app"))[0]?.coveredTo).toBeNull(); // untouched
  });

  it("uninstall closes every window for the installation; re-install opens a NEW window (gap preserved)", async () => {
    await applyCoverageEvent(pool, "installation", { action: "created", installation: { id: 7 }, repositories: [{ full_name: "acme/app" }] });
    await applyCoverageEvent(pool, "installation", { action: "deleted", installation: { id: 7 } });
    await applyCoverageEvent(pool, "installation", { action: "created", installation: { id: 9 }, repositories: [{ full_name: "acme/app" }] });

    const windows = await coverageFor(pool, "acme/app");
    expect(windows).toHaveLength(2);
    expect(windows[0]!.coveredTo).not.toBeNull(); // the first window is closed…
    expect(windows[1]!.coveredTo).toBeNull(); // …the gap between them is DECLARED, not papered over
  });

  it("webhook redelivery of an install does not open duplicate windows", async () => {
    const payload = { action: "created", installation: { id: 7 }, repositories: [{ full_name: "acme/app" }] };
    await applyCoverageEvent(pool, "installation", payload);
    await applyCoverageEvent(pool, "installation", payload);
    expect(await coverageFor(pool, "acme/app")).toHaveLength(1);
  });

  it("repos added/removed produce a corroborating spine event", () => {
    const ev = toStewardEvent("installation_repositories", {
      installation: { id: 7, account: { login: "acme" } },
      sender: { login: "dana" },
      repositories_added: [{ full_name: "acme/newrepo" }],
      repositories_removed: [],
    })!;
    expect(ev.eventType).toBe("installation.repos_changed");
    expect(ev.plainEnglish).toMatch(/now watching acme\/newrepo/);
  });
});
