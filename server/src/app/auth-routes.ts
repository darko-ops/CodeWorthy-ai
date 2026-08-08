// The dashboard's backend: "Sign in with GitHub" + the authenticated /api/*
// surface the SPA calls. Kept separate from the webhook/audit spine (index.ts)
// and the install flow (routes.ts).
//
// Auth model: the browser holds an opaque session id (see session.ts) and sends
// it as `Authorization: Bearer <id>`. No cookies — so no third-party-cookie
// pain between codeworthy.ai (SPA) and the Fly API, and revocation is a DELETE.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { config } from "../config.js";
import { recentChangelog } from "../audit/audit.js";
import { buildHealthReport } from "../health/health.js";
import { buildOverview } from "../health/overview.js";
import { flaggedCountsByRepo } from "../digest/digest.js";
import {
  authorizeUrl,
  exchangeCode,
  getUser,
  listInstallations,
  listRepositories,
  oauthConfigured,
  signState,
  userCanAccessRepo,
  verifyState,
} from "./oauth.js";
import { createSession, deleteSession, getSession, type UserSession } from "./session.js";

export function registerAuthRoutes(app: FastifyInstance, pool: Pool) {
  // --- CORS: allow the dashboard SPA origin to call /api/* with a bearer. ---
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin === config.webBaseUrl) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "origin");
      reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
      reply.header("access-control-allow-headers", "authorization,content-type");
      reply.header("access-control-max-age", "600");
    }
    if (req.method === "OPTIONS") {
      reply.code(204).send();
    }
  });

  // Pull the bearer session, or reply 401. Returns null after replying so the
  // handler can `return`.
  async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<UserSession | null> {
    const h = req.headers.authorization ?? "";
    const id = h.startsWith("Bearer ") ? h.slice(7) : "";
    const session = await getSession(pool, id);
    if (!session) {
      reply.code(401).send({ error: "unauthenticated" });
      return null;
    }
    return session;
  }

  // Step 1: kick off the OAuth dance. If the App isn't configured for user
  // OAuth yet, bounce back to the SPA with a clear reason instead of 500ing.
  app.get("/auth/github/login", async (_req, reply) => {
    if (!oauthConfigured()) {
      return reply.redirect(`${config.webBaseUrl}/login?error=not_configured`);
    }
    return reply.redirect(authorizeUrl(signState()));
  });

  // Step 2: GitHub redirects here. Verify state, trade the code for a user
  // token, create a session, and hand the SPA the id in the URL fragment
  // (fragments are never sent to servers or logged in Referer).
  app.get("/auth/github/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error) return reply.redirect(`${config.webBaseUrl}/login?error=${encodeURIComponent(q.error)}`);
    if (!q.code || !q.state || !verifyState(q.state)) {
      return reply.redirect(`${config.webBaseUrl}/login?error=bad_state`);
    }
    try {
      const token = await exchangeCode(q.code);
      const user = await getUser(token);
      const id = await createSession(pool, {
        login: user.login,
        name: user.name,
        avatar: user.avatar_url,
        token,
      });
      return reply.redirect(`${config.webBaseUrl}/auth/complete#session=${id}`);
    } catch (err) {
      app.log.error({ err }, "oauth callback failed");
      return reply.redirect(`${config.webBaseUrl}/login?error=oauth_failed`);
    }
  });

  // Who am I? (drives the signed-in header in the SPA)
  app.get("/api/me", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    return { login: s.login, name: s.name, avatar: s.avatar };
  });

  app.post("/api/logout", async (req, reply) => {
    const h = req.headers.authorization ?? "";
    const id = h.startsWith("Bearer ") ? h.slice(7) : "";
    if (id) await deleteSession(pool, id);
    return { ok: true };
  });

  // The repos this user can see through their CodeWorthy installations.
  app.get("/api/me/installations", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const insts = await listInstallations(s.token);
    return insts.map((i) => ({
      id: i.id,
      account: i.account?.login ?? "",
      avatar: i.account?.avatar_url ?? "",
      selection: i.repository_selection,
    }));
  });

  // Every repo full-name this user can see through their installations.
  async function accessibleRepos(token: string): Promise<string[]> {
    const insts = await listInstallations(token);
    const out: string[] = [];
    for (const inst of insts) {
      const rs = await listRepositories(token, inst.id);
      for (const r of rs) out.push(r.full_name);
    }
    return out;
  }

  // Flagged-event counts for every repo the user can see, in one call — so the
  // rail can badge problem repos without a health report per repo.
  app.get("/api/me/repo-flags", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const q = req.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) : 30;
    return flaggedCountsByRepo(pool, await accessibleRepos(s.token), days);
  });

  // The portfolio overview — all repos at a high level (per-repo status, flagged
  // count, activity) plus global integrity, for the main dashboard.
  app.get("/api/me/overview", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const q = req.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) : 30;
    return buildOverview(pool, await accessibleRepos(s.token), days);
  });

  app.get("/api/installations/:id/repositories", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isFinite(id)) {
      reply.code(400).send({ error: "bad installation id" });
      return;
    }
    const repos = await listRepositories(s.token, id);
    return repos.map((r) => ({
      full_name: r.full_name,
      name: r.name,
      private: r.private,
      default_branch: r.default_branch,
    }));
  });

  // A repo's Steward activity — gated: the caller must actually have access to
  // the repo through one of their installations before we return its log.
  app.get("/api/repos/:owner/:repo/activity", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string };
    const fullName = `${p.owner}/${p.repo}`;
    if (!(await userCanAccessRepo(s.token, fullName))) {
      reply.code(403).send({ error: "no access to repo" });
      return;
    }
    const q = req.query as { limit?: string; days?: string };
    const limit = q.limit ? parseInt(q.limit, 10) : 100;
    const sinceDays = q.days ? parseInt(q.days, 10) : undefined;
    return recentChangelog(pool, { repo: fullName, limit, sinceDays });
  });

  // A repo's health checkup (vitals + integrity), same access gate. Feeds the
  // dashboard's health ring, the tamper-evidence badge, and the details view in
  // one call. `days` sets the window the review-discipline vital and activity
  // summary look back over.
  app.get("/api/repos/:owner/:repo/health", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string };
    const fullName = `${p.owner}/${p.repo}`;
    if (!(await userCanAccessRepo(s.token, fullName))) {
      reply.code(403).send({ error: "no access to repo" });
      return;
    }
    const q = req.query as { days?: string };
    const windowDays = q.days ? parseInt(q.days, 10) : undefined;
    return buildHealthReport(pool, { repo: fullName, windowDays });
  });
}
