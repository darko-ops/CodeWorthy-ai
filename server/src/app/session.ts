// Server-side dashboard sessions. The browser holds only the opaque `id`; the
// GitHub user token lives here and never leaves the backend. See the
// 0002_user_sessions.sql migration for the rationale.
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";

const TTL_DAYS = 7;

export interface UserSession {
  id: string;
  login: string;
  name: string | null;
  avatar: string | null;
  token: string; // GitHub user-to-server token — server-side only
}

export async function createSession(
  pool: Pool,
  u: { login: string; name: string | null; avatar: string | null; token: string }
): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO user_sessions (id, gh_login, gh_name, gh_avatar, gh_token, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' days')::interval)`,
    [id, u.login, u.name, u.avatar, u.token, String(TTL_DAYS)]
  );
  return id;
}

// Look up a live session by id. Expired rows are treated as absent (and pruned).
export async function getSession(pool: Pool, id: string): Promise<UserSession | null> {
  if (!id) return null;
  const r = await pool.query(
    `SELECT id, gh_login, gh_name, gh_avatar, gh_token
       FROM user_sessions WHERE id = $1 AND expires_at > now()`,
    [id]
  );
  const row = r.rows[0];
  if (!row) {
    await pool.query("DELETE FROM user_sessions WHERE id = $1 AND expires_at <= now()", [id]).catch(() => {});
    return null;
  }
  return { id: row.id, login: row.gh_login, name: row.gh_name, avatar: row.gh_avatar, token: row.gh_token };
}

export async function deleteSession(pool: Pool, id: string): Promise<void> {
  await pool.query("DELETE FROM user_sessions WHERE id = $1", [id]);
}
