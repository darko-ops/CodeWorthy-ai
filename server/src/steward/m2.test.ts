import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import type { GitHubClient } from "../github/client.js";
import { recentChangelog } from "../audit/audit.js";
import { retroactiveReview } from "./mechanics.js";
import { configureProtection, detectProtectionDrift, runDriftCheck, STEWARD_CHECK } from "./protection.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

// A GitHubClient that records calls and returns configurable values — lets us
// test the mechanics without touching live GitHub, and prove they only ever use
// safe operations.
class FakeClient implements GitHubClient {
  calls: Array<{ m: string; args: unknown[] }> = [];
  protection: unknown = null;
  private rec<T>(m: string, args: unknown[], ret: T): Promise<T> { this.calls.push({ m, args }); return Promise.resolve(ret); }
  getPullRequestFiles(...a: any[]) { return this.rec("getPullRequestFiles", a, []); }
  listIssueComments(...a: any[]) { return this.rec("listIssueComments", a, []); }
  updateIssueComment(...a: any[]) { return this.rec("updateIssueComment", a, {}); }
  listPullRequestReviews(...a: any[]) { return this.rec("listPullRequestReviews", a, []); }
  listPullRequests(...a: any[]) { return this.rec("listPullRequests", a, []); }
  listCheckRunsForRef(...a: any[]) { return this.rec("listCheckRunsForRef", a, { check_runs: [] }); }
  getBranch(...a: any[]) { return this.rec("getBranch", a, {}); }
  getBranchProtection(...a: any[]) { this.calls.push({ m: "getBranchProtection", args: a }); return Promise.resolve(this.protection); }
  listCommits(...a: any[]) { return this.rec("listCommits", a, []); }
  listInstallationRepositories(...a: any[]) { return this.rec("listInstallationRepositories", a, [] as any); }
  createBranch(...a: any[]) { return this.rec("createBranch", a, {}); }
  openDraftPullRequest(...a: any[]) { return this.rec("openDraftPullRequest", a, {}); }
  createReviewComment(...a: any[]) { return this.rec("createReviewComment", a, {}); }
  createCommitComment(...a: any[]) { return this.rec("createCommitComment", a, {}); }
  createCheckRun(...a: any[]) { return this.rec("createCheckRun", a, {}); }
  setBranchProtection(...a: any[]) { return this.rec("setBranchProtection", a, {}); }
  names() { return this.calls.map((c) => c.m); }
}

const FORBIDDEN = /merge|force|delete/i;

afterAll(async () => { await pool.end(); }); // one pool for the whole file

describe("M2 safe-mechanics", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });

  it("retroactive review: preserves a branch, comments on the commit, logs — and uses no forbidden op", async () => {
    const c = new FakeClient();
    await retroactiveReview(c, pool, {
      repo: "acme/app", defaultBranch: "main", headSha: "abcdef1234567890",
      pusher: "dana", commitCount: 2, installationId: 7,
    });
    expect(c.names()).toContain("createBranch");
    expect(c.names()).toContain("createCommitComment");
    // the branch is named for the commit
    const branchCall = c.calls.find((x) => x.m === "createBranch")!;
    expect(branchCall.args[1]).toBe("steward/edit-abcdef123456");
    // never touched a dangerous op
    expect(c.names().filter((n) => FORBIDDEN.test(n))).toEqual([]);
    // logged
    const log = await recentChangelog(pool, { repo: "acme/app" });
    expect(log[0]!.event_type).toBe("mechanic.retroactive_review");
  });

  it("branch-protection configurator sets the right rules and logs", async () => {
    const c = new FakeClient();
    await configureProtection(c, pool, "acme/app", "main", 7);
    const call = c.calls.find((x) => x.m === "setBranchProtection")!;
    const rules = call.args[2] as any;
    expect(rules.allow_force_pushes).toBe(false);
    expect(rules.allow_deletions).toBe(false);
    expect(rules.required_pull_request_reviews).toBeTruthy();
    expect(rules.required_status_checks.contexts).toContain(STEWARD_CHECK);
    const log = await recentChangelog(pool, { repo: "acme/app" });
    expect(log[0]!.event_type).toBe("protection.configured");
  });
});

describe("M2 drift detection", () => {
  it("flags each way protection can be weakened", () => {
    expect(detectProtectionDrift(null)).toContain("branch protection is off entirely");
    expect(detectProtectionDrift({ allow_force_pushes: { enabled: true }, allow_deletions: { enabled: false }, required_pull_request_reviews: {}, required_status_checks: { contexts: [STEWARD_CHECK] } }))
      .toEqual(["force-pushes are now allowed"]);
    expect(detectProtectionDrift({ allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, required_status_checks: { contexts: [STEWARD_CHECK] } }))
      .toEqual(["a pull request is no longer required"]);
    const healthy = { allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false }, required_pull_request_reviews: {}, required_status_checks: { contexts: [STEWARD_CHECK] } };
    expect(detectProtectionDrift(healthy)).toEqual([]);
  });

  it("runDriftCheck logs a weakening as an audit event", async () => {
    await migrate(url); await pool.query("TRUNCATE audit_events");
    const c = new FakeClient();
    c.protection = { allow_force_pushes: { enabled: true }, allow_deletions: { enabled: false }, required_pull_request_reviews: {}, required_status_checks: { contexts: [STEWARD_CHECK] } };
    const weak = await runDriftCheck(c, pool, "acme/app", "main", 7);
    expect(weak).toContain("force-pushes are now allowed");
    const log = await recentChangelog(pool, { repo: "acme/app" });
    expect(log[0]!.event_type).toBe("exception.protection_weakened");
  });
});
