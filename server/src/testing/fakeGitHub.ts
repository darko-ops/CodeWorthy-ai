// One fake GitHub client for every suite.
//
// This existed five times, copied per test file, and every method added to
// GitHubClient broke all five at once — which is exactly the pressure that
// makes someone loosen the interface instead of implementing it. One base class
// means adding a capability breaks one file, and the doctrine tests that assert
// "the reviewer never calls a gating method" keep working unchanged.
//
// Suites extend it and override only what they need. `calls` records every
// invocation with its arguments, so a test can assert both WHAT was called and
// WITH WHAT — the second half is how the protection tests prove the ruleset
// payload is the one we intended.
//
// Not part of the production build (excluded in tsconfig.build.json).
import type { CheckRunInput, GitHubClient } from "../github/client.js";

export class FakeGitHub implements GitHubClient {
  calls: Array<{ m: string; args: unknown[] }> = [];

  // ── configurable responses (override in a subclass or assign per test) ──
  files: unknown = [];
  comments: Array<{ id: number; body: string }> = [];
  commits: unknown[] = [];
  reviews: unknown[] = [];
  checkRuns: unknown = { check_runs: [] };
  protection: unknown = null;
  repos: { full_name: string; default_branch: string }[] = [];
  rulesets: unknown[] = [];
  ruleset: unknown = null;
  pullRequest: unknown = {};
  commitDiff: unknown = { files: [] };
  commitPulls: unknown[] = [];

  protected rec<T>(m: string, args: unknown[], ret: T): Promise<T> {
    this.calls.push({ m, args });
    return Promise.resolve(ret);
  }

  // ── reads ──
  getPullRequestFiles(...a: any[]): Promise<unknown> { return this.rec("getPullRequestFiles", a, this.files); }
  listIssueComments(...a: any[]): Promise<unknown> { return this.rec("listIssueComments", a, this.comments); }
  listPullRequestReviews(...a: any[]): Promise<unknown> { return this.rec("listPullRequestReviews", a, this.reviews); }
  listPullRequestCommits(...a: any[]): Promise<unknown> { return this.rec("listPullRequestCommits", a, this.commits); }
  listCheckRunsForRef(...a: any[]): Promise<unknown> { return this.rec("listCheckRunsForRef", a, this.checkRuns); }
  getPullRequest(...a: any[]): Promise<unknown> { return this.rec("getPullRequest", a, this.pullRequest); }
  getCommitDiff(...a: any[]): Promise<unknown> { return this.rec("getCommitDiff", a, this.commitDiff); }
  listPullRequestsForCommit(...a: any[]): Promise<unknown> { return this.rec("listPullRequestsForCommit", a, this.commitPulls); }
  listPullRequests(...a: any[]): Promise<unknown> { return this.rec("listPullRequests", a, [] as unknown[]); }
  getBranch(...a: any[]): Promise<unknown> { return this.rec("getBranch", a, {}); }
  getBranchProtection(...a: any[]): Promise<unknown> { return this.rec("getBranchProtection", a, this.protection); }
  listRepoRulesets(...a: any[]): Promise<unknown> { return this.rec("listRepoRulesets", a, this.rulesets); }
  getRepoRuleset(...a: any[]): Promise<unknown> { return this.rec("getRepoRuleset", a, this.ruleset); }
  listCommits(...a: any[]): Promise<unknown> { return this.rec("listCommits", a, [] as unknown[]); }
  listInstallationRepositories(...a: any[]) { return this.rec("listInstallationRepositories", a, this.repos); }

  // ── writes (additive + reversible only) ──
  createBranch(...a: any[]): Promise<unknown> { return this.rec("createBranch", a, {}); }
  openDraftPullRequest(...a: any[]): Promise<unknown> { return this.rec("openDraftPullRequest", a, {}); }
  createReviewComment(...a: any[]): Promise<unknown> { return this.rec("createReviewComment", a, {}); }
  updateIssueComment(...a: any[]): Promise<unknown> { return this.rec("updateIssueComment", a, {}); }
  createCommitComment(...a: any[]): Promise<unknown> { return this.rec("createCommitComment", a, {}); }
  createCheckRun(...a: any[]): Promise<unknown> { return this.rec("createCheckRun", a, { id: 999 }); }
  updateCheckRun(...a: any[]): Promise<unknown> { return this.rec("updateCheckRun", a, { id: 999 }); }

  // ── admin ──
  createRepoRuleset(...a: any[]): Promise<unknown> { return this.rec("createRepoRuleset", a, { id: 1 }); }
  updateRepoRuleset(...a: any[]): Promise<unknown> { return this.rec("updateRepoRuleset", a, { id: 1 }); }
  setBranchProtection(...a: any[]): Promise<unknown> { return this.rec("setBranchProtection", a, {}); }

  // ── assertions helpers ──
  names(): string[] { return this.calls.map((c) => c.m); }
  argsFor(m: string): unknown[][] { return this.calls.filter((c) => c.m === m).map((c) => c.args); }
  countOf(m: string): number { return this.calls.filter((c) => c.m === m).length; }
  /** The body of the last check run posted, whichever verb posted it. */
  lastCheckRun(): CheckRunInput | undefined {
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i];
      if (!c) continue;
      if (c.m === "createCheckRun") return c.args[1] as CheckRunInput;
      if (c.m === "updateCheckRun") return c.args[2] as CheckRunInput;
    }
    return undefined;
  }
}
