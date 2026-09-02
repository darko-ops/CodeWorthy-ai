// The ONLY way the Steward App talks to the GitHub REST API.
//
// Doctrine, enforced by construction: this wrapper exposes ONLY safe,
// additive, reversible operations. There is deliberately no merge, no
// force-push, no ref/branch deletion — not "we don't call them," but "the
// capability does not exist on this surface." A CI test (client.doctrine.test.ts)
// asserts the exported method set contains none of those verbs, so the rule is
// mechanical, not conventional. The human owns every merge.
//
// M1 defines the surface; method bodies issue plain REST calls with the
// installation token. Live calls are exercised from M2 onward.
const API = "https://api.github.com";

async function gh(token: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GitHubHttpError(res.status, method, path);
  return res.status === 204 ? null : res.json();
}

/**
 * A failed GitHub call, carrying the status.
 *
 * The status matters: "404, there is no protection here" and "403, we are not
 * allowed to look" are the same string but opposite facts. Treating the second
 * as the first would have the reconciler write repo settings on the strength of
 * a permissions error, so callers branch on `status`, never on the message.
 */
export class GitHubHttpError extends Error {
  readonly rateLimited: boolean;
  readonly retryAfter: string | null;
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    meta: { rateLimited?: boolean; retryAfter?: string | null } = {}
  ) {
    super(`GitHub ${method} ${path} -> ${status}`);
    this.name = "GitHubHttpError";
    this.rateLimited = meta.rateLimited === true;
    this.retryAfter = meta.retryAfter ?? null;
  }
}

/** True when GitHub said "there is nothing here" — absence, not inaccessibility. */
export function isNotFound(err: unknown): boolean {
  return err instanceof GitHubHttpError && err.status === 404;
}

export interface GitHubClient {
  // ── read (metadata + diffs only; never executes customer code) ──
  getPullRequestFiles(repo: string, number: number): Promise<unknown>;
  listIssueComments(repo: string, number: number): Promise<unknown>;
  // Merge evidence reads (V0.2): who approved, and what the checks said.
  listPullRequestReviews(repo: string, number: number): Promise<unknown>;
  // The gate reads the PR's own commits (subjects) and the checks the repo's
  // OWN CI reported on the head commit — that second read is what lets the
  // gate refuse to pass a change whose tests are red.
  listPullRequestCommits(repo: string, number: number): Promise<unknown>;
  listCheckRunsForRef(repo: string, ref: string): Promise<unknown>;
  getPullRequest(repo: string, number: number): Promise<unknown>;
  /** One commit with its file patches — the diff a solo-mode review reads. */
  getCommitDiff(repo: string, sha: string): Promise<unknown>;
  /** Pull requests a commit belongs to — how we tell a merge from a bypass. */
  listPullRequestsForCommit(repo: string, sha: string): Promise<unknown>;
  // Reconciliation read (V1): the ground-truth population of merged PRs.
  listPullRequests(repo: string, params?: Record<string, string>): Promise<unknown>;
  getBranch(repo: string, branch: string): Promise<unknown>;
  getBranchProtection(repo: string, branch: string): Promise<unknown>;
  // Repository rulesets — the modern protection primitive (see rulesets.ts).
  listRepoRulesets(repo: string): Promise<unknown>;
  getRepoRuleset(repo: string, rulesetId: number): Promise<unknown>;
  listCommits(repo: string, params?: Record<string, string>): Promise<unknown>;
  listInstallationRepositories(): Promise<{ full_name: string; default_branch: string }[]>;
  // ── write: additive + reversible only ──
  createBranch(repo: string, newBranch: string, fromSha: string): Promise<unknown>;
  openDraftPullRequest(repo: string, opts: { head: string; base: string; title: string; body: string }): Promise<unknown>;
  createReviewComment(repo: string, number: number, body: string): Promise<unknown>;
  // Edits a comment the App itself posted (update-in-place instead of a new
  // comment per push — noise discipline). Never used on a human's comment.
  updateIssueComment(repo: string, commentId: number, body: string): Promise<unknown>;
  createCommitComment(repo: string, sha: string, body: string): Promise<unknown>;
  // The gate's verdict. This is the ONLY thing that ever posts the check that
  // branch protection requires — so it is also the only thing that can block a
  // merge. It blocks by reporting a conclusion; it never merges anything.
  createCheckRun(repo: string, opts: CheckRunInput): Promise<unknown>;
  updateCheckRun(repo: string, checkRunId: number, opts: CheckRunInput): Promise<unknown>;
  // ── admin: branch protection (the one privileged, consented capability) ──
  // Rulesets are the preferred mechanism; setBranchProtection is the fallback
  // for repos/plans where the rulesets API isn't available. Note there is
  // deliberately no way to REMOVE a ruleset from this surface: CodeWorthy can
  // turn protection on and restore it, and the human turns it off in GitHub.
  createRepoRuleset(repo: string, ruleset: unknown): Promise<unknown>;
  updateRepoRuleset(repo: string, rulesetId: number, ruleset: unknown): Promise<unknown>;
  setBranchProtection(repo: string, branch: string, rules: unknown): Promise<unknown>;
}

/** What a check run carries. `text` is the long-form markdown body. */
export interface CheckRunInput {
  name: string;
  headSha: string;
  conclusion: string;
  summary: string;
  title?: string;
  text?: string;
  detailsUrl?: string | null;
}

// NOTE: the keys of this object are exactly the public surface the doctrine test
// inspects. Adding a forbidden capability here would fail CI.
export function createGitHubClient(token: string): GitHubClient {
  return {
    getPullRequestFiles: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}/files`),
    listIssueComments: (repo, number) => gh(token, "GET", `/repos/${repo}/issues/${number}/comments?per_page=100`),
    listPullRequestReviews: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}/reviews?per_page=100`),
    listPullRequestCommits: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}/commits?per_page=100`),
    listCheckRunsForRef: (repo, ref) => gh(token, "GET", `/repos/${repo}/commits/${ref}/check-runs?per_page=100`),
    getPullRequest: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}`),
    getCommitDiff: (repo, sha) => gh(token, "GET", `/repos/${repo}/commits/${sha}`),
    listPullRequestsForCommit: (repo, sha) => gh(token, "GET", `/repos/${repo}/commits/${sha}/pulls?per_page=10`),
    listPullRequests: (repo, params = {}) => gh(token, "GET", `/repos/${repo}/pulls?${new URLSearchParams(params)}`),
    getBranch: (repo, branch) => gh(token, "GET", `/repos/${repo}/branches/${branch}`),
    getBranchProtection: (repo, branch) => gh(token, "GET", `/repos/${repo}/branches/${branch}/protection`),
    listRepoRulesets: (repo) => gh(token, "GET", `/repos/${repo}/rulesets?includes_parents=false&per_page=100`),
    getRepoRuleset: (repo, rulesetId) => gh(token, "GET", `/repos/${repo}/rulesets/${rulesetId}`),
    listCommits: (repo, params = {}) => gh(token, "GET", `/repos/${repo}/commits?${new URLSearchParams(params)}`),
    listInstallationRepositories: async () => {
      const res = (await gh(token, "GET", `/installation/repositories?per_page=100`)) as { repositories?: Array<{ full_name: string; default_branch: string }> };
      return (res.repositories ?? []).map((r) => ({ full_name: r.full_name, default_branch: r.default_branch }));
    },

    createBranch: (repo, newBranch, fromSha) =>
      gh(token, "POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${newBranch}`, sha: fromSha }),
    openDraftPullRequest: (repo, o) =>
      gh(token, "POST", `/repos/${repo}/pulls`, { head: o.head, base: o.base, title: o.title, body: o.body, draft: true }),
    createReviewComment: (repo, number, body) =>
      gh(token, "POST", `/repos/${repo}/issues/${number}/comments`, { body }),
    updateIssueComment: (repo, commentId, body) =>
      gh(token, "PATCH", `/repos/${repo}/issues/comments/${commentId}`, { body }),
    createCommitComment: (repo, sha, body) =>
      gh(token, "POST", `/repos/${repo}/commits/${sha}/comments`, { body }),
    createCheckRun: (repo, o) => gh(token, "POST", `/repos/${repo}/check-runs`, checkRunBody(o)),
    updateCheckRun: (repo, checkRunId, o) => gh(token, "PATCH", `/repos/${repo}/check-runs/${checkRunId}`, checkRunBody(o)),

    createRepoRuleset: (repo, ruleset) => gh(token, "POST", `/repos/${repo}/rulesets`, ruleset),
    updateRepoRuleset: (repo, rulesetId, ruleset) => gh(token, "PUT", `/repos/${repo}/rulesets/${rulesetId}`, ruleset),
    setBranchProtection: (repo, branch, rules) =>
      gh(token, "PUT", `/repos/${repo}/branches/${branch}/protection`, rules),
  };
}

// One body shape for create and update, so a check run says the same thing
// whichever path posted it.
function checkRunBody(o: CheckRunInput) {
  return {
    name: o.name,
    head_sha: o.headSha,
    status: "completed",
    conclusion: o.conclusion,
    ...(o.detailsUrl ? { details_url: o.detailsUrl } : {}),
    output: { title: o.title ?? o.name, summary: o.summary, ...(o.text ? { text: o.text } : {}) },
  };
}

// The verbs this surface must never contain. The test enforces it; this constant
// documents the intent and is the single place to read the rule.
export const FORBIDDEN_CAPABILITY = /merge|force|delete|destroy|remove/i;
