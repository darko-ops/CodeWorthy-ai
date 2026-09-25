// Share tokens — what makes ONE repository's record forwardable without making
// EVERY repository's record public.
//
// The digest and health pages are meant to be handed to a teammate or an
// auditor, who will not have a CodeWorthy login. That product requirement was
// previously met by serving them to anyone who asked, with the repo named in a
// query string — so `?repo=` was an oracle over every repo in the database, and
// omitting it dumped the lot. The link needs to be a CAPABILITY, not an
// address: unguessable, scoped to one repo, and expiring.
//
// A token is `s1.<repo, base64url>.<expiry ms>.<HMAC>`. The repo travels INSIDE
// the signed body and is read back out of it — the reader never trusts a
// `?repo=` parameter alongside the token, so there is no second value to
// disagree with the first.
import { createHmac, timingSafeEqual } from "node:crypto";
import { signingSecret } from "./secret.js";

const VERSION = "s1";

/** Long enough that a link forwarded to an auditor still works next month. */
export const DEFAULT_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const mac = (body: string) => createHmac("sha256", signingSecret()).update(body).digest("base64url");

export function signShareToken(repo: string, nowMs: number = Date.now(), ttlMs: number = DEFAULT_SHARE_TTL_MS): string {
  const body = `${VERSION}.${Buffer.from(repo, "utf8").toString("base64url")}.${nowMs + ttlMs}`;
  return `${body}.${mac(body)}`;
}

/**
 * The repository this token authorizes, or null if it authorizes nothing.
 *
 * Null covers every failure the same way on purpose — wrong signature, expired,
 * malformed, truncated. A caller that could tell those apart would be a probe
 * for which repositories exist.
 */
export function shareTokenRepo(token: string | undefined, nowMs: number = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, repoPart, expiry, signature] = parts;
  if (version !== VERSION || !repoPart || !expiry || !signature) return null;

  const expected = mac(`${version}.${repoPart}.${expiry}`);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;

  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;

  // The signature already proves we minted it; the shape check is here so a
  // key compromise can't turn this into an arbitrary string the SQL layer
  // treats as a repo name.
  const repo = Buffer.from(repoPart, "base64url").toString("utf8");
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) ? repo : null;
}

/** An absolute, ready-to-forward link to one repo's rendered digest. */
export function shareUrlFor(baseUrl: string, repo: string, days: number, path = "/steward/digest.html"): string {
  const t = signShareToken(repo);
  return `${baseUrl}${path}?repo=${encodeURIComponent(repo)}&days=${days}&t=${encodeURIComponent(t)}`;
}
