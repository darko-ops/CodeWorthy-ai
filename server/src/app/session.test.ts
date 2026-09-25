// What a database disclosure yields.
//
// `user_sessions` held two secrets in cleartext: the GitHub user-to-server
// token, and the opaque bearer the browser sends as `Authorization: Bearer`.
// So a Neon backup, a leaked read-only connection string, a console session or
// a query in a log handed over every signed-in user's GitHub account AND a set
// of directly replayable sessions.
//
// The load-bearing test is the raw row read below. It deliberately serializes
// the WHOLE row rather than naming columns, so it asserts the property ("no
// secret is legible in this table") rather than a schema — and so this exact
// file runs on both sides of the change that renames those columns.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import { createSession, deleteSession, getSession } from "./session.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

const GH_TOKEN = "ghu_aVeryRecognisablePlaintextToken0123456789";
const user = { login: "acme-owner", name: "Acme Owner", avatar: null, token: GH_TOKEN };

/** The whole row as text — column names unknown on purpose. */
async function rawRowText(): Promise<string> {
  const { rows } = await pool.query("SELECT * FROM user_sessions");
  return JSON.stringify(rows);
}

describe("session secrets at rest", () => {
  beforeEach(async () => {
    await migrate(url);
    await pool.query("DELETE FROM user_sessions");
  });
  afterAll(async () => { await pool.end(); });

  it("stores neither the bearer nor the GitHub token in legible form", async () => {
    const id = await createSession(pool, user);
    const stored = await rawRowText();

    expect(stored).not.toContain(GH_TOKEN); // the GitHub account
    expect(stored).not.toContain(id);       // the replayable bearer
  });

  it("still returns the plaintext token to the backend that needs it", async () => {
    const id = await createSession(pool, user);
    const session = await getSession(pool, id);

    expect(session).not.toBeNull();
    expect(session!.token).toBe(GH_TOKEN);  // callers are unaffected
    expect(session!.login).toBe("acme-owner");
  });

  it("an unknown bearer is no session", async () => {
    await createSession(pool, user);
    expect(await getSession(pool, "not-a-real-session-id")).toBeNull();
    expect(await getSession(pool, "")).toBeNull();
  });

  it("deleting a session makes its bearer stop working", async () => {
    const id = await createSession(pool, user);
    await deleteSession(pool, id);
    expect(await getSession(pool, id)).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM user_sessions")).rows[0].n).toBe(0);
  });

  it("a session encrypted under a different key is signed out, not 500'd", async () => {
    // Rotation, simulated by writing a row this process cannot read. The point
    // is that changing STEWARD_TOKEN_KEY needs no DELETE pass and no
    // re-encryption: stale sessions evict themselves when next presented.
    const id = "a-bearer-from-before-the-rotation";
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", randomBytes(32), iv);
    const body = Buffer.concat([c.update("ghu_old", "utf8"), c.final()]);
    const foreign = ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
    await pool.query(
      `INSERT INTO user_sessions (id_sha256, gh_login, gh_name, gh_avatar, gh_token_enc, expires_at)
       VALUES ($1, 'old-user', null, null, $2, now() + interval '7 days')`,
      [createHash("sha256").update(id, "utf8").digest("hex"), foreign]
    );

    const logged: string[] = [];
    expect(await getSession(pool, id, (m) => logged.push(m))).toBeNull();
    expect(logged.join(" ")).toMatch(/could not be decrypted/);
    // Evicted, so it is not retried on every subsequent request.
    expect((await pool.query("SELECT count(*)::int AS n FROM user_sessions")).rows[0].n).toBe(0);
  });

  it("an expired session is absent, and does not linger", async () => {
    const id = await createSession(pool, user);
    await pool.query("UPDATE user_sessions SET expires_at = now() - interval '1 hour'");
    expect(await getSession(pool, id)).toBeNull();
    expect((await pool.query("SELECT count(*)::int AS n FROM user_sessions")).rows[0].n).toBe(0);
  });
});
