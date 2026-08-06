// GitHub App auth + the doctrine-constrained API client.
//
// The client exposes ONLY the operations Steward's policy permits. There is
// deliberately no merge, no ref deletion, no force update, and no history
// rewrite anywhere in this file — test/doctrine.test.mjs asserts it and fails
// CI if a forbidden capability is ever added. The human owns every merge.
import { createSign, createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.github.com";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

// Short-lived App JWT (RS256), used only to mint installation tokens.
export function appJwt(appId, privateKeyPem, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: String(appId) })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKeyPem).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

// Webhook signature verification (X-Hub-Signature-256).
export function verifyWebhookSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class GitHubError extends Error {
  constructor(status, message, body) {
    super(`GitHub ${status}: ${message}`);
    this.status = status;
    this.body = body;
  }
}

// The only API surface Steward has. Additions require a doctrine review:
// nothing here may merge, delete refs, force-update refs, or rewrite history.
export class StewardClient {
  constructor({ token, fetchImpl = fetch }) {
    this.token = token;
    this.fetch = fetchImpl;
  }

  async request(method, path, body, headers = {}) {
    const res = await this.fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new GitHubError(res.status, json?.message ?? res.statusText, json);
    return json;
  }

  // ── read ────────────────────────────────────────────────────────────────
  getRepo(owner, repo) {
    return this.request("GET", `/repos/${owner}/${repo}`);
  }
  getPull(owner, repo, number) {
    return this.request("GET", `/repos/${owner}/${repo}/pulls/${number}`);
  }
  async getPullDiff(owner, repo, number, maxBytes = 200_000) {
    const res = await this.fetch(`${API}/repos/${owner}/${repo}/pulls/${number}`, {
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github.v3.diff",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) throw new GitHubError(res.status, "could not fetch diff");
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) + "\n...[diff truncated]" : text;
  }
  listPullsForBranch(owner, repo, branch) {
    return this.request("GET", `/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${branch}`);
  }
  async getFileContent(owner, repo, path, ref) {
    try {
      const res = await this.request(
        "GET",
        `/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`
      );
      return Buffer.from(res.content, "base64").toString("utf8");
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }
  getBranchProtection(owner, repo, branch) {
    return this.request("GET", `/repos/${owner}/${repo}/branches/${branch}/protection`).catch(
      (err) => (err.status === 404 ? null : Promise.reject(err))
    );
  }

  // ── additive write (reversible; creates, never destroys) ────────────────
  createRef(owner, repo, ref, sha) {
    return this.request("POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${ref}`, sha });
  }
  createDraftPull(owner, repo, { title, head, base, body }) {
    return this.request("POST", `/repos/${owner}/${repo}/pulls`, {
      title,
      head,
      base,
      body,
      draft: true,
    });
  }
  updatePullBody(owner, repo, number, body) {
    return this.request("PATCH", `/repos/${owner}/${repo}/pulls/${number}`, { body });
  }
  createIssueComment(owner, repo, number, body) {
    return this.request("POST", `/repos/${owner}/${repo}/issues/${number}/comments`, { body });
  }
  createCommitComment(owner, repo, sha, body) {
    return this.request("POST", `/repos/${owner}/${repo}/commits/${sha}/comments`, { body });
  }
  createReview(owner, repo, number, { body, comments }) {
    // event COMMENT only: the model advises; it never requests changes and
    // never approves — approval is a human signal, not an AI one.
    return this.request("POST", `/repos/${owner}/${repo}/pulls/${number}/reviews`, {
      body,
      event: "COMMENT",
      comments,
    });
  }
  createCheckRun(owner, repo, payload) {
    return this.request("POST", `/repos/${owner}/${repo}/check-runs`, payload);
  }
  updateCheckRun(owner, repo, checkRunId, payload) {
    return this.request("PATCH", `/repos/${owner}/${repo}/check-runs/${checkRunId}`, payload);
  }

  // ── configuration (the product's one privileged act) ────────────────────
  applyBranchProtection(owner, repo, branch, protection) {
    return this.request("PUT", `/repos/${owner}/${repo}/branches/${branch}/protection`, protection);
  }
}

// Installation-token minting with a small cache.
export class TokenBroker {
  constructor({ appId, privateKeyPem, fetchImpl = fetch }) {
    this.appId = appId;
    this.privateKeyPem = privateKeyPem;
    this.fetch = fetchImpl;
    this.cache = new Map(); // installationId -> { token, expiresAt }
  }

  async tokenFor(installationId) {
    const cached = this.cache.get(installationId);
    if (cached && Date.parse(cached.expiresAt) - Date.now() > 60_000) return cached.token;
    const jwt = appJwt(this.appId, this.privateKeyPem);
    const res = await this.fetch(`${API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${jwt}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    });
    const json = await res.json();
    if (!res.ok) throw new GitHubError(res.status, json?.message ?? "token minting failed", json);
    this.cache.set(installationId, { token: json.token, expiresAt: json.expires_at });
    return json.token;
  }

  async clientFor(installationId) {
    return new StewardClient({ token: await this.tokenFor(installationId), fetchImpl: this.fetch });
  }
}
