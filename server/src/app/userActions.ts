// The HUMAN's GitHub surface — a third actor, deliberately separate from the
// two the product already has.
//
// CodeWorthy's doctrine is "the human owns every merge", and it is enforced
// structurally: github/client.ts (the reviewer App) cannot express a merge, and
// approver/client.ts cannot either — both have doctrine tests that fail the
// build if anyone adds one. Nothing in this file weakens that. What it adds is
// the other half of the sentence: if the human owns every merge, the human
// needs somewhere to perform one.
//
// Three properties make that safe, and all three are load-bearing:
//
//   1. It runs on the SIGNED-IN USER'S OWN token, never an installation token.
//      GitHub authorises the call against that person's permissions, so the
//      dashboard cannot do anything they could not do themselves on github.com.
//   2. Every function here takes a token as its first argument and has no
//      access to the App's credentials. There is no code path from a webhook,
//      a scheduler, or a background job to any of it — a merge requires a live
//      human session, by construction.
//   3. Every call is recorded on the audit spine with that person's login
//      before it is reported as done. A merge performed here is more
//      accountable than the same click on github.com, not less.
//
// The doctrine test (userActions.doctrine.test.ts) asserts 1 and 2 mechanically.
import { GitHubHttpError } from "../github/client.js";

const API = "https://api.github.com";

async function gh<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "codeworthy-steward",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    // GitHub's own message is the useful one here ("Base branch was modified",
    // "At least 1 approving review is required"). Carry it rather than
    // replacing it with our guess — see the reply shape in auth-routes.
    let detail: string | null = null;
    try {
      const j = (await res.json()) as { message?: string };
      detail = j?.message ?? null;
    } catch {
      /* no body */
    }
    throw new GitHubHttpError(res.status, method, path, { detail });
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** What the signed-in user may do in this repository, per GitHub. */
export async function userRepoPermissions(
  token: string,
  repo: string
): Promise<{ push: boolean; admin: boolean }> {
  try {
    const r = await gh<{ permissions?: { push?: boolean; admin?: boolean } }>(token, "GET", `/repos/${repo}`);
    return { push: Boolean(r.permissions?.push), admin: Boolean(r.permissions?.admin) };
  } catch {
    // A read failure must not be reported as "you have write access".
    return { push: false, admin: false };
  }
}

/** Say something in the thread — a normal pull-request comment, as the user. */
export function commentAsUser(token: string, repo: string, number: number, body: string): Promise<{ id: number; html_url: string }> {
  return gh(token, "POST", `/repos/${repo}/issues/${number}/comments`, { body });
}

/** Submit the user's own approving review. */
export function approveAsUser(
  token: string,
  repo: string,
  number: number,
  body: string
): Promise<{ id: number; state: string; html_url: string }> {
  return gh(token, "POST", `/repos/${repo}/pulls/${number}/reviews`, {
    event: "APPROVE",
    ...(body ? { body } : {}),
  });
}

export type MergeMethod = "merge" | "squash" | "rebase";

/**
 * Merge, as the human.
 *
 * `sha` is not optional by accident. GitHub refuses the merge if the head
 * commit has moved since the dashboard rendered it — which is exactly the
 * failure we want, because the thing the user read and approved is no longer
 * the thing that would land. Without it, a merge button on a page a minute old
 * can ship a commit nobody in this conversation ever saw.
 */
export function mergeAsUser(
  token: string,
  repo: string,
  number: number,
  opts: { sha: string; method?: MergeMethod; title?: string }
): Promise<{ sha: string; merged: boolean; message: string }> {
  return gh(token, "PUT", `/repos/${repo}/pulls/${number}/merge`, {
    sha: opts.sha,
    merge_method: opts.method ?? "squash",
    ...(opts.title ? { commit_title: opts.title } : {}),
  });
}

/**
 * The verbs this surface is allowed to contain.
 *
 * The reviewer and approver surfaces are defined by what they must NEVER do.
 * This one is the opposite: it is an allowlist, because it is the file where a
 * privileged verb is legitimate, and the protection has to be that nothing ELSE
 * creeps in beside it. Force-pushing, deleting branches and changing protection
 * are not here and must not be — those are not "the human owns the merge", they
 * are the destruction of the record the merge is written into.
 */
export const USER_ACTION_ALLOWLIST = [
  "userRepoPermissions",
  "commentAsUser",
  "approveAsUser",
  "mergeAsUser",
] as const;
