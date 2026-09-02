// The approver's GitHub surface — deliberately its own, and deliberately tiny.
//
// This is not the Steward's client with an extra method. The whole value of an
// independent approver is that it is a different actor with different powers,
// and the cheapest way to make that true rather than merely stated is to give
// it a separate surface that CAN approve, while the Steward's surface CANNOT.
// A doctrine test asserts exactly that in both directions.
//
// What it may do: read a pull request's comments and files, and submit ONE
// review. It cannot merge, cannot push, cannot change settings, and cannot post
// the check that gates the merge — that belongs to the reviewer, and an actor
// that could do both would be approving its own work.
import { createSign } from "node:crypto";
import { config } from "../config.js";

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
  if (!res.ok) throw new Error(`approver ${method} ${path} -> ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export type ReviewEvent = "APPROVE" | "COMMENT";

export interface ApproverClient {
  listIssueComments(repo: string, number: number): Promise<unknown>;
  listPullRequestReviews(repo: string, number: number): Promise<unknown>;
  getPullRequestFiles(repo: string, number: number): Promise<unknown>;
  /** The one privileged act: a review on a pull request. Never a merge. */
  submitReview(repo: string, number: number, o: { event: ReviewEvent; body: string; commitId?: string }): Promise<unknown>;
  /** Who we post as — used to make sure we never count our own waiver. */
  whoAmI(): Promise<string>;
}

export function createApproverClient(token: string, login: string): ApproverClient {
  return {
    listIssueComments: (repo, number) => gh(token, "GET", `/repos/${repo}/issues/${number}/comments?per_page=100`),
    listPullRequestReviews: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}/reviews?per_page=100`),
    getPullRequestFiles: (repo, number) => gh(token, "GET", `/repos/${repo}/pulls/${number}/files?per_page=100`),
    submitReview: (repo, number, o) =>
      gh(token, "POST", `/repos/${repo}/pulls/${number}/reviews`, {
        event: o.event,
        body: o.body,
        ...(o.commitId ? { commit_id: o.commitId } : {}),
      }),
    whoAmI: async () => login,
  };
}

/** Verbs this surface must never contain — same doctrine, separate actor. */
export const APPROVER_FORBIDDEN = /merge|force|delete|destroy|remove|protection|checkrun|check_run/i;

// ── auth: the approver's OWN app credentials ────────────────────────────────
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function approverConfigured(): boolean {
  return Boolean(config.approver.appId && config.approver.privateKey);
}

function approverJwt(nowSec: number = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 540, iss: config.approver.appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  return `${header}.${payload}.${b64url(signer.sign(config.approver.privateKey))}`;
}

/**
 * The approver App's own installation on this repo.
 *
 * It is a DIFFERENT app, so it has different installation ids — reusing the
 * Steward's would authenticate as the reviewer, quietly collapsing the two
 * actors into one and making the approval worthless.
 */
export async function approverClientFor(repo: string): Promise<ApproverClient | null> {
  if (!approverConfigured()) return null;
  const jwt = approverJwt();
  const headers = { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

  const instRes = await fetch(`${API}/repos/${repo}/installation`, { headers });
  if (!instRes.ok) return null; // approver not installed here — it simply abstains
  const installationId = ((await instRes.json()) as { id?: number }).id;
  if (installationId == null) return null;

  const tokRes = await fetch(`${API}/app/installations/${installationId}/access_tokens`, { method: "POST", headers });
  if (!tokRes.ok) return null;
  const token = ((await tokRes.json()) as { token: string }).token;

  // The app's own slug becomes the login it posts as ("<slug>[bot]").
  const appRes = await fetch(`${API}/app`, { headers });
  const slug = appRes.ok ? ((await appRes.json()) as { slug?: string }).slug ?? "codeworthy-approver" : "codeworthy-approver";
  return createApproverClient(token, `${slug}[bot]`);
}
