// Server-side dashboard sessions.
//
// The browser holds only the opaque `id`; the GitHub user token lives here and
// never leaves the backend. See the 0002_user_sessions.sql migration for that
// rationale — it is why an XSS on the SPA cannot steal a GitHub token.
//
// 0006 addresses the threat that reasoning does NOT cover: disclosure of the
// database itself. Both secrets used to sit in this table in cleartext, so a
// backup, a leaked read-only connection string, a console session or a logged
// query handed over every signed-in user's GitHub account and a set of directly
// replayable bearers. Now:
//
//   id        stored as sha256(id). Plain hash, no key — the id is 32 bytes of
//             randomBytes, so there is nothing to brute-force or rainbow-table
//             and keyed hashing would add ceremony, not security. The raw value
//             exists only in the browser and in this process's memory.
//   gh_token  AES-256-GCM under STEWARD_TOKEN_KEY (see tokenCrypto.ts), which
//             lives in a Fly secret rather than in the database.
//
// The interface is unchanged, deliberately: callers still receive a plaintext
// `token` on UserSession and know nothing about any of this.
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { decryptToken, encryptToken } from "./tokenCrypto.js";

const TTL_DAYS = 7;

/** What the database stores in place of the bearer the browser holds. */
const idHash = (id: string) => createHash("sha256").update(id, "utf8").digest("hex");

export interface UserSession {
  id: string;
  login: string;
  name: string | null;
  avatar: string | null;
  token: string; // GitHub user-to-server token — server-side only
}

/**
 * Create a session and hand the caller the RAW id for the browser.
 *
 * Throws when no key is configured rather than falling back to plaintext: a
 * misconfigured deploy must not quietly reintroduce the thing this exists to
 * prevent. `oauthConfigured()` checks the same key, so the sign-in route
 * refuses earlier and with a better message than this ever needs to.
 */
export async function createSession(
  pool: Pool,
  u: { login: string; name: string | null; avatar: string | null; token: string }
): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO user_sessions (id_sha256, gh_login, gh_name, gh_avatar, gh_token_enc, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)`,
    [idHash(id), u.login, u.name, u.avatar, encryptToken(u.token), String(TTL_DAYS)]
  );
  return id;
}

/**
 * Look up a live session by the raw id. Expired rows are treated as absent (and
 * pruned) — and so are rows that will not decrypt.
 *
 * That second case is what makes key rotation self-cleaning: set a new
 * STEWARD_TOKEN_KEY and every old session evicts itself the next time anyone
 * presents it. No DELETE pass, no re-encryption, no downtime — just a re-login.
 * It is logged, because "everyone was signed out" should be explicable after the
 * fact rather than mysterious.
 */
export async function getSession(
  pool: Pool,
  id: string,
  log?: (msg: string) => void
): Promise<UserSession | null> {
  if (!id) return null;
  const hashed = idHash(id);
  const r = await pool.query(
    `SELECT gh_login, gh_name, gh_avatar, gh_token_enc
       FROM user_sessions WHERE id_sha256 = $1 AND expires_at > now()`,
    [hashed]
  );
  const row = r.rows[0];
  if (!row) {
    await pool.query("DELETE FROM user_sessions WHERE id_sha256 = $1 AND expires_at <= now()", [hashed]).catch(() => {});
    return null;
  }

  const token = decryptToken(row.gh_token_enc);
  if (token === null) {
    log?.(`session for ${row.gh_login} could not be decrypted — STEWARD_TOKEN_KEY has changed; signing them out`);
    await pool.query("DELETE FROM user_sessions WHERE id_sha256 = $1", [hashed]).catch(() => {});
    return null;
  }

  return { id, login: row.gh_login, name: row.gh_name, avatar: row.gh_avatar, token };
}

export async function deleteSession(pool: Pool, id: string): Promise<void> {
  await pool.query("DELETE FROM user_sessions WHERE id_sha256 = $1", [idHash(id)]);
}
