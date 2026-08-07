// GitHub App user-to-server OAuth — the "Sign in with GitHub" flow behind the
// dashboard. This is distinct from the App/installation auth in github/auth.ts:
// there we act AS the App; here a human authorizes the App and we act on THEIR
// behalf to read which repos they can see and gate the dashboard.
//
// No octokit, no oauth lib — node:crypto + fetch, mirroring github/auth.ts.
//
// The flow:
//   1. /auth/github/login -> redirect to authorizeUrl(state)
//   2. GitHub -> /auth/github/callback?code&state
//   3. exchangeCode(code) -> a user access token
//   4. getUser / listInstallations / listRepositories use that token
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const GH = "https://github.com";
const API = "https://api.github.com";

export function oauthConfigured(): boolean {
  return Boolean(config.github.clientId && config.github.clientSecret);
}

function secret(): string {
  // A boot-time fallback keeps a single instance working without config; set
  // STEWARD_SESSION_SECRET in prod so state/sessions survive restarts.
  return config.sessionSecret || BOOT_SECRET;
}
const BOOT_SECRET = randomBytes(32).toString("hex");

// The OAuth redirect target GitHub is configured to call back.
export function callbackUrl(): string {
  return `${config.baseUrl}/auth/github/callback`;
}

// --- CSRF state: a signed, short-lived nonce carried through the round trip ---
export function signState(nowMs: number = Date.now()): string {
  const nonce = randomBytes(12).toString("hex");
  const body = `${nonce}.${nowMs}`;
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyState(state: string, nowMs: number = Date.now(), maxAgeMs = 10 * 60_000): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, ts, mac] = parts;
  if (!nonce || !ts || !mac) return false;
  const expected = createHmac("sha256", secret()).update(`${nonce}.${ts}`).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = nowMs - Number(ts);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

export function authorizeUrl(state: string): string {
  const u = new URL(`${GH}/login/oauth/authorize`);
  u.searchParams.set("client_id", config.github.clientId);
  u.searchParams.set("redirect_uri", callbackUrl());
  u.searchParams.set("state", state);
  // Prompt the user to pick which installations to authorize (so a fresh
  // install can be selected inline). Harmless when already authorized.
  u.searchParams.set("allow_signup", "false");
  return u.toString();
}

// Exchange the temporary code for a user access token.
export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(`${GH}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "codeworthy-steward" },
    body: JSON.stringify({
      client_id: config.github.clientId,
      client_secret: config.github.clientSecret,
      code,
      redirect_uri: callbackUrl(),
    }),
  });
  if (!res.ok) throw new Error(`oauth token exchange -> ${res.status}`);
  const j = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!j.access_token) throw new Error(`oauth token exchange: ${j.error_description || j.error || "no token"}`);
  return j.access_token;
}

async function ghGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "codeworthy-steward",
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}
export function getUser(token: string): Promise<GitHubUser> {
  return ghGet<GitHubUser>(token, "/user");
}

export interface Installation {
  id: number;
  account: { login: string; avatar_url: string } | null;
  repository_selection: "all" | "selected";
}
// The App installations THIS user can see (i.e. where they authorized us).
export async function listInstallations(token: string): Promise<Installation[]> {
  const j = await ghGet<{ installations: Installation[] }>(token, "/user/installations?per_page=100");
  return j.installations ?? [];
}

export interface Repo {
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
}
export async function listRepositories(token: string, installationId: number): Promise<Repo[]> {
  const j = await ghGet<{ repositories: Repo[] }>(
    token,
    `/user/installations/${installationId}/repositories?per_page=100`
  );
  return j.repositories ?? [];
}

// Gate helper: does this user have access to owner/name through some
// installation? Used before returning a repo's Steward activity so the
// (currently public) changelog is only served to someone who can see the repo.
export async function userCanAccessRepo(token: string, fullName: string): Promise<boolean> {
  const insts = await listInstallations(token);
  for (const inst of insts) {
    const repos = await listRepositories(token, inst.id);
    if (repos.some((r) => r.full_name.toLowerCase() === fullName.toLowerCase())) return true;
  }
  return false;
}
