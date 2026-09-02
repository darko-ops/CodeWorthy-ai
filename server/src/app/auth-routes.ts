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
import { mapGitHubError } from "./apiErrors.js";
import { allowedWebOrigins } from "./webOrigins.js";
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
  installationForRepo,
  userCanAccessRepo,
  verifyState,
} from "./oauth.js";
import { createSession, deleteSession, getSession, type UserSession } from "./session.js";
import { getInstallationClient } from "../github/auth.js";
import { approvalRequired, ensureProtection } from "../steward/enforce.js";
import { getRepoMode, isRepoMode, setRepoMode } from "../steward/repoMode.js";
import { getRepoRules, parseRules, setRepoRules } from "../steward/repoRules.js";
import { appendAuditEvent } from "../audit/audit.js";

export function registerAuthRoutes(app: FastifyInstance, pool: Pool) {
  // --- CORS: allow the dashboard SPA origins to call /api/* with a bearer. ---
  // Computed once at registration; an allowlist, never a wildcard, because
  // these endpoints carry a bearer session.
  const allowedOrigins = allowedWebOrigins(config.webBaseUrl, config.webOriginsExtra);
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
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

  // Every route below talks to GitHub with the user's token, and any non-2xx
  // throws. An unhandled throw is a Fastify 500 — which is a lie about almost
  // all of these: an expired token is the user's to fix in one click, and a
  // GitHub outage is not our internal error. Anything that is NOT a GitHub
  // transport failure is re-thrown, so real bugs still 500 loudly.
  async function withGitHub<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      const mapped = mapGitHubError(err);
      if (!mapped) throw err;
      app.log.warn({ err, status: mapped.status }, "github call failed");
      reply.code(mapped.status).send(mapped.body);
      return undefined;
    }
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
    return withGitHub(reply, async () => {
      const insts = await listInstallations(s.token);
      return insts.map((i) => ({
        id: i.id,
        account: i.account?.login ?? "",
        avatar: i.account?.avatar_url ?? "",
        selection: i.repository_selection,
      }));
    });
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
    return withGitHub(reply, async () => flaggedCountsByRepo(pool, await accessibleRepos(s.token), days));
  });

  // The portfolio overview — all repos at a high level (per-repo status, flagged
  // count, activity) plus global integrity, for the main dashboard.
  app.get("/api/me/overview", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const q = req.query as { days?: string };
    const days = q.days ? parseInt(q.days, 10) : 30;
    return withGitHub(reply, async () => buildOverview(pool, await accessibleRepos(s.token), days));
  });

  app.get("/api/installations/:id/repositories", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const id = parseInt((req.params as { id: string }).id, 10);
    if (!Number.isFinite(id)) {
      reply.code(400).send({ error: "bad installation id" });
      return;
    }
    return withGitHub(reply, async () => {
      const repos = await listRepositories(s.token, id);
      return repos.map((r) => ({
        full_name: r.full_name,
        name: r.name,
        private: r.private,
        default_branch: r.default_branch,
      }));
    });
  });

  // A repo's Steward activity — gated: the caller must actually have access to
  // the repo through one of their installations before we return its log.
  app.get("/api/repos/:owner/:repo/activity", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string };
    const fullName = `${p.owner}/${p.repo}`;
    return withGitHub(reply, async () => {
      if (!(await userCanAccessRepo(s.token, fullName))) {
        reply.code(403).send({ error: "no access to repo" });
        return;
      }
      const q = req.query as { limit?: string; days?: string };
      const limit = q.limit ? parseInt(q.limit, 10) : 100;
      const sinceDays = q.days ? parseInt(q.days, 10) : undefined;
      return recentChangelog(pool, { repo: fullName, limit, sinceDays });
    });
  });

  // Set how a repository is worked on, and reshape its protection to match.
  //
  // This is the switch that lets a single maintainer keep working in their own
  // repo. Solo mode drops the pull-request requirement and keeps the
  // irreversible operations blocked; shared mode restores the full rule.
  app.post("/api/repos/:owner/:repo/mode", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string };
    const fullName = `${p.owner}/${p.repo}`;
    // NOTE: a global JSON content-type parser (steward/routes.ts) wraps every
    // JSON body as { raw, json } so the webhook can verify its signature over
    // the exact bytes GitHub sent. Any other JSON route has to unwrap it.
    const raw = req.body as { json?: unknown } | undefined;
    const body = ((raw && "json" in raw ? raw.json : raw) ?? {}) as { mode?: unknown; reason?: unknown };
    if (!isRepoMode(body.mode)) {
      reply.code(400).send({ error: "bad_mode", message: 'mode must be "solo" or "shared".' });
      return;
    }
    const mode = body.mode;

    return withGitHub(reply, async () => {
      if (!(await userCanAccessRepo(s.token, fullName))) {
        reply.code(403).send({ error: "no access to repo" });
        return;
      }
      const installationId = await installationForRepo(s.token, fullName);
      // The decision is recorded first and separately from the settings change,
      // so the record shows what was intended even if GitHub then refuses.
      await setRepoMode(pool, {
        repo: fullName,
        mode,
        actor: s.login,
        installationId,
        ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      });
      if (installationId == null) {
        return { ok: true, mode, protection: "not_installed" };
      }
      const client = await getInstallationClient(installationId);
      const repoInfo = (await client.listInstallationRepositories()).find(
        (r) => r.full_name.toLowerCase() === fullName.toLowerCase()
      );
      const result = await ensureProtection(client, pool, fullName, installationId, {
        defaultBranch: repoInfo?.default_branch ?? "main",
        mode,
      });
      return { ok: true, mode, protection: result.action, mechanism: result.mechanism, detail: result.detail ?? null };
    });
  });

  // The "one click" behind most recommended options: apply the protection this
  // repo's mode calls for. Same code path and same audit events as the consent
  // flow, scoped to one repository the caller has proven access to.
  app.post("/api/repos/:owner/:repo/protect", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string };
    const fullName = `${p.owner}/${p.repo}`;
    return withGitHub(reply, async () => {
      if (!(await userCanAccessRepo(s.token, fullName))) {
        reply.code(403).send({ error: "no access to repo" });
        return;
      }
      const installationId = await installationForRepo(s.token, fullName);
      if (installationId == null) {
        reply.code(409).send({ error: "not_installed", message: "CodeWorthy isn't installed on this repository, so it can't change its settings." });
        return;
      }
      const client = await getInstallationClient(installationId);
      const repoInfo = (await client.listInstallationRepositories()).find(
        (r) => r.full_name.toLowerCase() === fullName.toLowerCase()
      );
      const result = await ensureProtection(client, pool, fullName, installationId, {
        defaultBranch: repoInfo?.default_branch ?? "main",
      });
      // A failure here is the interesting case, not an error to swallow: it is
      // how the dashboard LEARNS the constraint exists (a private repo on a
      // free plan, say) and re-renders with the options that work around it.
      if (result.action === "failed") {
        reply.code(409).send({
          error: "protection_unavailable",
          message: "GitHub wouldn't let CodeWorthy protect this branch. Reload for the other ways to fix this.",
          detail: result.detail ?? null,
        });
        return;
      }
      return { ok: true, mechanism: result.mechanism, action: result.action };
    });
  });

  // "This risk is mine and I'm keeping it." The last option on every issue, so
  // a repo can always reach a settled state — recorded with who decided and
  // when, which is what makes it a judgement call rather than an oversight.
  app.post("/api/repos/:owner/:repo/accept/:issueId", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string; issueId: string };
    const fullName = `${p.owner}/${p.repo}`;
    if (!/^[a-z0-9_]{1,64}$/.test(p.issueId)) {
      reply.code(400).send({ error: "bad issue id" });
      return;
    }
    return withGitHub(reply, async () => {
      if (!(await userCanAccessRepo(s.token, fullName))) {
        reply.code(403).send({ error: "no access to repo" });
        return;
      }
      await appendAuditEvent(pool, {
        installationId: await installationForRepo(s.token, fullName),
        repo: fullName,
        eventType: "issue.accepted",
        actor: s.login,
        payload: { issueId: p.issueId },
        plainEnglish: `${s.login} reviewed the "${p.issueId.replace(/_/g, " ")}" finding on ${fullName} and accepted it deliberately. CodeWorthy stops flagging it; the risk and the decision both stay in the record.`,
      });
      return { ok: true, accepted: p.issueId };
    });
  });

  // ── the rules page ────────────────────────────────────────────────────────
  // What has to be true for a change to land here. Read and written from the
  // dashboard rather than a file in the repo, because the client deliberately
  // cannot read repository contents — and because who changed a rule, when, and
  // to what belongs in the append-only record rather than in a commit someone
  // can rewrite.
  app.get("/api/repos/:owner/:repo/rules", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string };
    const fullName = `${p.owner}/${p.repo}`;
    return withGitHub(reply, async () => {
      if (!(await userCanAccessRepo(s.token, fullName))) {
        reply.code(403).send({ error: "no access to repo" });
        return;
      }
      const [rules, mode] = await Promise.all([getRepoRules(pool, fullName), getRepoMode(pool, fullName)]);
      return {
        repo: fullName,
        mode,
        rules,
        // Whether an approving review can actually be required here. The UI
        // shows the control disabled, with the reason, rather than letting
        // someone ask for an approval nothing can give.
        approverAvailable: await approvalRequired(fullName),
      };
    });
  });

  app.post("/api/repos/:owner/:repo/rules", async (req, reply) => {
    const s = await requireSession(req, reply);
    if (!s) return;
    const p = req.params as { owner: string; repo: string };
    const fullName = `${p.owner}/${p.repo}`;
    // The webhook's raw-body JSON parser wraps every JSON body (see the mode route).
    const raw = req.body as { json?: unknown } | undefined;
    const body = ((raw && "json" in raw ? raw.json : raw) ?? {}) as { rules?: unknown; mode?: unknown };

    return withGitHub(reply, async () => {
      if (!(await userCanAccessRepo(s.token, fullName))) {
        reply.code(403).send({ error: "no access to repo" });
        return;
      }
      const installationId = await installationForRepo(s.token, fullName);
      const previous = await getRepoRules(pool, fullName);
      const rules = parseRules(body.rules, previous);
      const changes = await setRepoRules(pool, { repo: fullName, rules, previous, actor: s.login, installationId });

      // Mode keeps its own event and its own reader — one source of truth for
      // the setting that decides what "protected" means at all.
      let mode = await getRepoMode(pool, fullName);
      if (isRepoMode(body.mode) && body.mode !== mode) {
        await setRepoMode(pool, { repo: fullName, mode: body.mode, actor: s.login, installationId });
        mode = body.mode;
      }

      if (installationId == null) return { ok: true, rules, mode, changes, protection: "not_installed" };
      const client = await getInstallationClient(installationId);
      const repoInfo = (await client.listInstallationRepositories()).find(
        (r) => r.full_name.toLowerCase() === fullName.toLowerCase()
      );
      const applied = await ensureProtection(client, pool, fullName, installationId, {
        defaultBranch: repoInfo?.default_branch ?? "main",
        mode,
      });
      return { ok: true, rules, mode, changes, protection: applied.action, mechanism: applied.mechanism };
    });
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
    return withGitHub(reply, async () => {
      if (!(await userCanAccessRepo(s.token, fullName))) {
        reply.code(403).send({ error: "no access to repo" });
        return;
      }
      const q = req.query as { days?: string };
      const windowDays = q.days ? parseInt(q.days, 10) : undefined;
      return buildHealthReport(pool, { repo: fullName, windowDays });
    });
  });
}
