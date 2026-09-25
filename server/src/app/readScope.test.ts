// The read surface, end to end.
//
// Guards the two holes these routes had, at the level they existed:
//
//   1. /steward/{changelog,digest,health} answered anyone, and with no `?repo=`
//      they answered with EVERY repository in the database — one tenant's
//      record served to another, and to the open internet.
//   2. Scope was taken from a query parameter, so naming someone else's repo
//      was the same request as naming your own.
//
// These assert the shape of the fix rather than its implementation: an
// anonymous caller gets nothing, a share link gets exactly one repository, and
// a session gets exactly the repositories that session can see.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { buildServer } from "../index.js";
import { appendAuditEvent } from "../audit/audit.js";
import { createSession } from "./session.js";
import { signShareToken } from "./shareToken.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });
const app = buildServer(pool);

const MINE = "acme/orders";
const THEIRS = "rival/ledger";

/** Stand in for GitHub's user-to-server API: this user can see MINE only. */
function stubGitHub(repos: string[] = [MINE]) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const path = new URL(String(input)).pathname;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (path === "/user/installations") return json({ installations: [{ id: 42, account: { login: "acme" }, repository_selection: "all" }] });
    if (path === "/user/installations/42/repositories") {
      return json({ repositories: repos.map((r) => ({ full_name: r, name: r.split("/")[1], private: true, default_branch: "main" })) });
    }
    return new Response("{}", { status: 404 });
  });
}

async function seed() {
  for (const repo of [MINE, THEIRS]) {
    await appendAuditEvent(pool, {
      installationId: 42,
      repo,
      eventType: "push.direct_to_default",
      actor: "someone",
      payload: {},
      plainEnglish: `a change landed on ${repo}`,
    });
  }
}

describe("the record's read surface is scoped", () => {
  beforeEach(async () => {
    await migrate(url);
    await pool.query("TRUNCATE audit_events");
    await pool.query("DELETE FROM user_sessions");
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
    await pool.end();
  });

  // ── 1. anonymous gets nothing ────────────────────────────────────────────
  for (const path of ["/steward/changelog", "/steward/digest", "/steward/digest.html", "/steward/health", "/steward/health.html"]) {
    it(`${path} refuses an anonymous caller`, async () => {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(401);
    });

    it(`${path} refuses an anonymous caller who names a repository`, async () => {
      // The old oracle: naming a repo was all it took.
      const res = await app.inject({ method: "GET", url: `${path}?repo=${encodeURIComponent(THEIRS)}` });
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain(THEIRS.split("/")[1]);
    });
  }

  it("refuses a forged share token", async () => {
    const res = await app.inject({ method: "GET", url: `/steward/digest?repo=${THEIRS}&t=s1.AAAA.99999999999999.AAAA` });
    expect(res.statusCode).toBe(403);
  });

  // ── 2. a share link is one repository, and only the one it names ─────────
  it("a share token returns that repository's record with no login", async () => {
    await seed();
    const res = await app.inject({ method: "GET", url: `/steward/changelog?t=${encodeURIComponent(signShareToken(MINE))}` });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ repo: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.repo === MINE)).toBe(true);
  });

  it("a share token ignores a ?repo= that disagrees with it", async () => {
    await seed();
    // The token says acme/orders; the URL asks for rival/ledger. The token is
    // the authority — otherwise the parameter is the oracle all over again.
    const res = await app.inject({
      method: "GET",
      url: `/steward/changelog?repo=${encodeURIComponent(THEIRS)}&t=${encodeURIComponent(signShareToken(MINE))}`,
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ repo: string }>;
    expect(rows.every((r) => r.repo === MINE)).toBe(true);
  });

  // ── 3. a session sees its own estate, and no more ────────────────────────
  it("a session with no ?repo= gets ITS repositories, not every repository", async () => {
    await seed();
    stubGitHub([MINE]);
    const id = await createSession(pool, { login: "acme-owner", name: null, avatar: null, token: "gh-token" });
    const res = await app.inject({ method: "GET", url: "/steward/changelog", headers: { authorization: `Bearer ${id}` } });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ repo: string }>;
    expect(rows.some((r) => r.repo === MINE)).toBe(true);
    expect(rows.some((r) => r.repo === THEIRS)).toBe(false);
  });

  it("a session is refused a repository it cannot see", async () => {
    await seed();
    stubGitHub([MINE]);
    const id = await createSession(pool, { login: "acme-owner", name: null, avatar: null, token: "gh-token" });
    const res = await app.inject({
      method: "GET",
      url: `/steward/changelog?repo=${encodeURIComponent(THEIRS)}`,
      headers: { authorization: `Bearer ${id}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a session that can see nothing gets nothing — an empty scope is not 'no filter'", async () => {
    await seed();
    stubGitHub([]);
    const id = await createSession(pool, { login: "nobody", name: null, avatar: null, token: "gh-token" });
    const res = await app.inject({ method: "GET", url: "/steward/digest", headers: { authorization: `Bearer ${id}` } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { totalEvents: number }).totalEvents).toBe(0);
  });

  // ── 4. the health page is one repository, always ─────────────────────────
  it("the health page asks for a repository rather than reporting on all of them", async () => {
    stubGitHub([MINE]);
    const id = await createSession(pool, { login: "acme-owner", name: null, avatar: null, token: "gh-token" });
    const res = await app.inject({ method: "GET", url: "/steward/health", headers: { authorization: `Bearer ${id}` } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "repo_required" });
  });

  // ── 5. junk parameters are junk, not a 500 ───────────────────────────────
  it("clamps nonsense windows instead of handing NaN to Postgres", async () => {
    const t = encodeURIComponent(signShareToken(MINE));
    for (const q of ["limit=abc", "days=abc", "limit=-5", "days=99999"]) {
      const res = await app.inject({ method: "GET", url: `/steward/changelog?${q}&t=${t}` });
      expect(res.statusCode).toBe(200);
    }
  });

  // ── 6. the integrity endpoint stays open, and stays anonymous ────────────
  it("integrity is still public, and still names nobody", async () => {
    await seed();
    const res = await app.inject({ method: "GET", url: "/steward/integrity" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(MINE);
    expect(res.body).not.toContain(THEIRS);
  });
});
