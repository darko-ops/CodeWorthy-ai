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
import { buildOverview, type OverviewRepoInput } from "../health/overview.js";
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
import { getThread, listThreads, parseThreadKey, type ThreadKey } from "../threads/threads.js";
import {
  approveAsUser,
  commentAsUser,
  mergeAsUser,
  userRepoPermissions,
  type MergeMethod,
} from "./userActions.js";

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

  // Every repo this user can see through their installations. The overview
  // needs more than the name — visibility and the default branch decide how a
  // row reads and which branch a decision names — so the GitHub payload is
  // carried through rather than flattened to strings here.
  async function accessibleRepos(token: string): Promise<OverviewRepoInput[]> {
    const insts = await listInstallations(token);
    const out: OverviewRepoInput[] = [];
    for (const inst of insts) {
      const rs = await listRepositories(token, inst.id);
      for (const r of rs) {
        out.push({ full_name: r.full_name, private: r.private, default_branch: r.default_branch });
      }
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
    return withGitHub(reply, async () =>
      flaggedCountsByRepo(pool, (await accessibleRepos(s.token)).map((r) => r.full_name), days)
    );
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

  // Taking that back. The acceptance is NOT deleted — the spine is append-only,
  // and a record you can quietly edit is worth nothing. Instead this appends the
  // reversal, so the history reads "accepted, then reconsidered", with both
  // times and both names. CodeWorthy starts flagging the finding again.
  app.post("/api/repos/:owner/:repo/unaccept/:issueId", async (req, reply) => {
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
        eventType: "issue.unaccepted",
        actor: s.login,
        payload: { issueId: p.issueId },
        plainEnglish: `${s.login} withdrew the acceptance of the "${p.issueId.replace(/_/g, " ")}" finding on ${fullName}. The earlier decision stays in the record; CodeWorthy raises the finding again.`,
      });
      return { ok: true, unaccepted: p.issueId };
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

  // ── threads: the repository's conversation ────────────────────────────────
  //
  // Read through the INSTALLATION client (the App's doctrine-checked read
  // surface), written through the user's own token (userActions.ts). That split
  // is the whole security model of this section: CodeWorthy reads everything it
  // is installed to read, and the three things a human can do to a pull request
  // happen as that human, with their permissions, under their name.

  /** Shared preamble: prove access, then hand back everything both halves need. */
  async function threadContext(
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<{ session: UserSession; repo: string; installationId: number } | null> {
    const s = await requireSession(req, reply);
    if (!s) return null;
    const p = req.params as { owner: string; repo: string };
    const repo = `${p.owner}/${p.repo}`;
    // One lookup, not two. `userCanAccessRepo` and `installationForRepo` compute
    // the same predicate over the same paged GitHub calls — and this endpoint is
    // POLLED, so asking twice doubles the rate-limit cost of every tick for an
    // answer we already have. A null id IS "no access": the repo is not in any
    // installation this user can see.
    const installationId = await installationForRepo(s.token, repo);
    if (installationId == null) {
      reply.code(403).send({
        error: "no_access",
        message:
          "You don't have access to this repository through your CodeWorthy installations — or CodeWorthy isn't installed on it.",
      });
      return null;
    }
    return { session: s, repo, installationId };
  }

  /** The thread list — one GitHub call and one query, whatever the repo size. */
  app.get("/api/repos/:owner/:repo/threads", async (req, reply) => {
    return withGitHub(reply, async () => {
      const ctx = await threadContext(req, reply);
      if (!ctx) return;
      const sinceDays = windowFrom(req);
      const client = await getInstallationClient(ctx.installationId);
      const threads = await listThreads(client, pool, {
        repo: ctx.repo,
        sinceDays,
        viewer: ctx.session.login,
      });
      return { repo: ctx.repo, windowDays: sinceDays, threads };
    });
  });

  /**
   * One thread in full.
   *
   * The key travels in the query string, not a path segment: a branch name
   * contains slashes (`feat/idempotent-checkout`), and encoding those into a
   * path is a source of routing bugs that only show up on the branch names
   * people actually use.
   */
  app.get("/api/repos/:owner/:repo/thread", async (req, reply) => {
    return withGitHub(reply, async () => {
      const ctx = await threadContext(req, reply);
      if (!ctx) return;
      const key = threadKeyFrom((req.query as { key?: string }).key, reply);
      if (!key) return;
      const client = await getInstallationClient(ctx.installationId);
      // The merge button is only offered to someone GitHub would actually let
      // merge. Asking first means the button is absent with a reason rather
      // than present and failing.
      const perms = await userRepoPermissions(ctx.session.token, ctx.repo);
      const thread = await getThread(client, pool, {
        repo: ctx.repo,
        key,
        viewer: ctx.session.login,
        sinceDays: windowFrom(req),
        canPush: perms.push,
      });
      if (!thread) {
        reply.code(404).send({
          error: "no_thread",
          message: "That branch isn't there any more — it may have been merged and deleted, or renamed.",
        });
        return;
      }
      return thread;
    });
  });

  /**
   * The three things a human can do to a pull request.
   *
   * Each needs a LIVE pull request, so they share a preamble that resolves the
   * thread key to a number and refuses with the reason when there isn't one —
   * a branch nobody has opened a PR on has nowhere to post.
   */
  async function pullRequestFor(
    req: FastifyRequest,
    reply: FastifyReply,
    ctx: { repo: string; installationId: number },
    verb: string
  ): Promise<number | null> {
    const body = jsonBody<{ key?: unknown }>(req);
    const key = threadKeyFrom(typeof body.key === "string" ? body.key : undefined, reply);
    if (!key) return null;
    if (key.kind === "archived") return key.number;

    const client = await getInstallationClient(ctx.installationId);
    const pulls = (await client
      .listPullRequests(ctx.repo, { state: "open", head: `${ctx.repo.split("/")[0]}:${key.branch}`, per_page: "1" })
      .catch(() => [])) as Array<{ number?: number }>;
    const number = pulls[0]?.number;
    if (number == null) {
      reply.code(409).send({
        error: "no_pull_request",
        message: `There's no open pull request on ${key.branch} to ${verb}. Open one and the conversation moves there.`,
      });
      return null;
    }
    return number;
  }

  /** Say something in the thread. Posts as the user, on the pull request. */
  app.post("/api/repos/:owner/:repo/thread/reply", async (req, reply) => {
    return withGitHub(reply, async () => {
      const ctx = await threadContext(req, reply);
      if (!ctx) return;
      const number = await pullRequestFor(req, reply, ctx, "reply on");
      if (number == null) return;
      const body = jsonBody<{ body?: unknown }>(req);
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text) {
        reply.code(400).send({ error: "empty", message: "Write something first." });
        return;
      }
      if (text.length > 60_000) {
        reply.code(400).send({ error: "too_long", message: "That's longer than GitHub will accept for one comment." });
        return;
      }
      const posted = await commentAsUser(ctx.session.token, ctx.repo, number, text);
      await appendAuditEvent(pool, {
        installationId: ctx.installationId,
        repo: ctx.repo,
        eventType: "human.commented",
        actor: ctx.session.login,
        payload: { number, commentId: posted.id },
        plainEnglish: `${ctx.session.login} replied on PR #${number} in ${ctx.repo} from the CodeWorthy dashboard.`,
      });
      return { ok: true, url: posted.html_url };
    });
  });

  /** The user's own approving review. Their identity, their judgement. */
  app.post("/api/repos/:owner/:repo/thread/approve", async (req, reply) => {
    return withGitHub(reply, async () => {
      const ctx = await threadContext(req, reply);
      if (!ctx) return;
      const number = await pullRequestFor(req, reply, ctx, "approve");
      if (number == null) return;
      const body = jsonBody<{ body?: unknown }>(req);
      const note = typeof body.body === "string" ? body.body.trim() : "";
      const res = await approveAsUser(ctx.session.token, ctx.repo, number, note);
      await appendAuditEvent(pool, {
        installationId: ctx.installationId,
        repo: ctx.repo,
        eventType: "human.approved",
        actor: ctx.session.login,
        payload: { number, reviewId: res.id },
        plainEnglish: `${ctx.session.login} approved PR #${number} in ${ctx.repo} from the CodeWorthy dashboard.`,
      });
      return { ok: true, url: res.html_url };
    });
  });

  /**
   * Merge — the one act CodeWorthy itself cannot perform.
   *
   * It runs on the user's token, it requires the head SHA the dashboard showed
   * them (so a commit that landed since cannot be merged unseen), and it is on
   * the record with their login before this returns. The App's own clients
   * still have no merge capability and never will — see userActions.ts.
   */
  app.post("/api/repos/:owner/:repo/thread/merge", async (req, reply) => {
    return withGitHub(reply, async () => {
      const ctx = await threadContext(req, reply);
      if (!ctx) return;
      const number = await pullRequestFor(req, reply, ctx, "merge");
      if (number == null) return;
      const body = jsonBody<{ sha?: unknown; method?: unknown }>(req);
      const sha = typeof body.sha === "string" ? body.sha : "";
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
        reply.code(400).send({
          error: "no_sha",
          message: "The dashboard didn't say which commit it was merging. Reload the thread and try again.",
        });
        return;
      }
      const method: MergeMethod =
        body.method === "merge" || body.method === "rebase" || body.method === "squash" ? body.method : "squash";
      const perms = await userRepoPermissions(ctx.session.token, ctx.repo);
      if (!perms.push) {
        reply.code(403).send({
          error: "no_write_access",
          message: "You don't have write access to this repository, so GitHub won't let you merge here.",
        });
        return;
      }
      const res = await mergeAsUser(ctx.session.token, ctx.repo, number, { sha, method });
      await appendAuditEvent(pool, {
        installationId: ctx.installationId,
        repo: ctx.repo,
        eventType: "human.merged",
        actor: ctx.session.login,
        payload: { number, headSha: sha, mergeSha: res.sha ?? null, method },
        plainEnglish: `${ctx.session.login} merged PR #${number} in ${ctx.repo} from the CodeWorthy dashboard (${method}).`,
      });
      return { ok: true, sha: res.sha ?? null, message: res.message ?? "Merged." };
    });
  });
}

/** Parse a thread key, or reply 400 and return null. */
function threadKeyFrom(raw: string | undefined, reply: FastifyReply): ThreadKey | null {
  const key = raw ? parseThreadKey(raw) : null;
  if (!key) {
    reply.code(400).send({ error: "bad_thread", message: "That isn't a thread on this repository." });
    return null;
  }
  return key;
}

/** The look-back window, clamped. A junk `?days=` must not become NaN and be
 *  echoed back to the client as the window it used. */
function windowFrom(req: FastifyRequest): number {
  const raw = parseInt((req.query as { days?: string }).days ?? "", 10);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(Math.max(raw, 1), 365);
}

/**
 * The parsed JSON body.
 *
 * A global content-type parser (steward/routes.ts) wraps every JSON body as
 * { raw, json } so the webhook can verify its signature over the exact bytes
 * GitHub sent. Every other JSON route has to unwrap it.
 */
function jsonBody<T extends object>(req: FastifyRequest): T {
  const raw = req.body as { json?: unknown } | undefined;
  return ((raw && "json" in raw ? raw.json : raw) ?? {}) as T;
}
