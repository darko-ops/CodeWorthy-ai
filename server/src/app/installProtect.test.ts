// The hole this guards.
//
// POST /steward/setup/protect took an installation id in its request body and
// applied branch protection to every repository that id named. No session, no
// CSRF token, no proof of ownership — so the only thing between a stranger and
// another customer's branch-protection settings was guessing a small integer.
// The response listed every repo in the installation, which made the same
// request a private-repo name oracle.
//
// Branch protection is the ONE privileged capability this product has. It now
// lives behind a session that has proven, with the caller's own GitHub token,
// that the installation is theirs.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { buildServer } from "../index.js";
import { createSession } from "./session.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });
const app = buildServer(pool);

/** This user owns installation 42 and nothing else. */
function stubGitHub() {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === "/user/installations") {
      return new Response(JSON.stringify({ installations: [{ id: 42, account: { login: "acme" }, repository_selection: "all" }] }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}

describe("turning on branch protection requires owning the installation", () => {
  beforeEach(async () => {
    await migrate(url);
    await pool.query("DELETE FROM user_sessions");
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
    await pool.end();
  });

  it("the anonymous endpoint is gone", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/steward/setup/protect",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "installation_id=42",
    });
    expect(res.statusCode).toBe(404);
  });

  it("refuses an anonymous caller", async () => {
    const res = await app.inject({ method: "POST", url: "/api/installations/42/protect" });
    expect(res.statusCode).toBe(401);
  });

  it("refuses an installation the caller does not own", async () => {
    stubGitHub();
    const id = await createSession(pool, { login: "stranger", name: null, avatar: null, token: "gh-token" });
    const res = await app.inject({
      method: "POST",
      url: "/api/installations/99/protect",
      headers: { authorization: `Bearer ${id}` },
    });
    expect(res.statusCode).toBe(403);
    // The refusal must not distinguish "someone else's" from "doesn't exist" —
    // that difference is the enumeration oracle in another shape.
    expect(res.json()).toMatchObject({ error: "no_access" });
  });

  it("rejects an installation id that isn't one", async () => {
    stubGitHub();
    const id = await createSession(pool, { login: "stranger", name: null, avatar: null, token: "gh-token" });
    const res = await app.inject({
      method: "POST",
      url: "/api/installations/not-a-number/protect",
      headers: { authorization: `Bearer ${id}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
