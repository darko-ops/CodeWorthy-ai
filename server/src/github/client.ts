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
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export interface GitHubClient {
  // ── read (metadata + diffs only; never executes customer code) ──
  getPullRequestFiles(repo: string, number: number): Promise<unknown>;
  listIssueComments(repo: string, number: number): Promise<unknown>;
  // Merge evidence reads (V0.2): who approved, and what the checks said.
  listPullRequestReviews(repo: string, number: number): Promise<unknown>;
  listCheckRunsForRef(repo: string, ref: string): Promise<unknown>;
  // Reconciliation read (V1): the ground-truth population of merged PRs.
  listPullRequests(repo: string, params?: Record<string, string>): Promise<unknown>;
  getBranch(repo: string, branch: string): Promise<unknown>;
  getBranchProtection(repo: string, branch: string): Promise<unknown>;
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
  createCheckRun(repo: string, opts: { name: string; headSha: string; conclusion: string; summary: string }): Promise<unknown>;
  // ── admin: branch protection (the one privileged, consented capability) ──
  setBranchProtection(repo: string, branch: string, rules: unknown): Promise<unknown>;
}

// NOTE: the keys of this object are exactly the public surface the doctrine test
// inspects. Adding a forbidden capability here would fail CI.
export function createGitHubClient(token: string): GitHubClient {
  return {
    getPullRequestFiles: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}/files`),
    listIssueComments: (repo, number) => gh(token, "GET", `/repos/${repo}/issues/${number}/comments?per_page=100`),
    listPullRequestReviews: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}/reviews?per_page=100`),
    listCheckRunsForRef: (repo, ref) => gh(token, "GET", `/repos/${repo}/commits/${ref}/check-runs?per_page=100`),
    listPullRequests: (repo, params = {}) => gh(token, "GET", `/repos/${repo}/pulls?${new URLSearchParams(params)}`),
    getBranch: (repo, branch) => gh(token, "GET", `/repos/${repo}/branches/${branch}`),
    getBranchProtection: (repo, branch) => gh(token, "GET", `/repos/${repo}/branches/${branch}/protection`),
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
    createCheckRun: (repo, o) =>
      gh(token, "POST", `/repos/${repo}/check-runs`, {
        name: o.name, head_sha: o.headSha, status: "completed", conclusion: o.conclusion,
        output: { title: o.name, summary: o.summary },
      }),

    setBranchProtection: (repo, branch, rules) =>
      gh(token, "PUT", `/repos/${repo}/branches/${branch}/protection`, rules),
  };
}

// The verbs this surface must never contain. The test enforces it; this constant
// documents the intent and is the single place to read the rule.
export const FORBIDDEN_CAPABILITY = /merge|force|delete|destroy|remove/i;
