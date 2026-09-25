// CodeWorthy backend service entry. One deployment, two bounded modules:
// steward/ (GitHub App webhook + audit) and api/ (site backend seed). Shared
// Pool; separate schemas keep them cleanly splittable later.
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { Pool } from "pg";
import { config } from "./config.js";
import { registerApi } from "./api/health.js";
import { registerAnchors } from "./api/anchors.js";
import { registerSteward } from "./steward/routes.js";
import { recentChangelog } from "./audit/audit.js";
import { verifyAuditChain, verifyAgainstAnchor, makeAnchor } from "./audit/tamper.js";
import { buildDigest } from "./digest/digest.js";
import { renderDigestHtml, renderDigestText } from "./digest/render.js";
import { buildHealthReport } from "./health/health.js";
import { renderHealthHtml } from "./health/render.js";
import { registerAppRoutes } from "./app/routes.js";
import { registerAuthRoutes } from "./app/auth-routes.js";
import { intParam, resolveReadScope, resolveRepoScope, scopeFilter } from "./app/readScope.js";
import { startScheduler } from "./scheduler.js";

export function buildServer(pool: Pool) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // ── the record's read surface ─────────────────────────────────────────────
  //
  // Everything below reads the audit spine, and every one of them resolves its
  // scope through readScope.ts rather than off a query parameter. The rule the
  // guard enforces, stated once here because it is the reason these routes look
  // the way they do: you get a repository because you hold a share link for it,
  // or because your session can see it. There is no third way, and there is no
  // unscoped form — "every repo in the database" is an operator query, not an
  // HTTP response.
  //
  // The rendered pages stay forwardable to someone with no login: that is what
  // the share token is for. It just has to be a link somebody was GIVEN.

  app.get("/steward/changelog", async (req, reply) => {
    const scope = await resolveReadScope(pool, req, reply);
    if (!scope) return;
    const q = req.query as { limit?: string; days?: string };
    return recentChangelog(pool, {
      ...scopeFilter(scope),
      limit: intParam(q.limit, 50, 1, 500),
      ...(q.days ? { sinceDays: intParam(q.days, 30, 1, 365) } : {}),
    });
  });

  // The weekly digest — the founder-facing artifact (and the auditor's evidence).
  const digestFor = async (req: FastifyRequest, reply: FastifyReply) => {
    const scope = await resolveReadScope(pool, req, reply);
    if (!scope) return null;
    const q = req.query as { days?: string };
    return buildDigest(pool, { ...scopeFilter(scope), periodDays: intParam(q.days, 7, 1, 90) });
  };
  app.get("/steward/digest", async (req, reply) => {
    const d = await digestFor(req, reply);
    return d ?? undefined;
  });
  app.get("/steward/digest.html", async (req, reply) => {
    const d = await digestFor(req, reply);
    if (!d) return;
    reply.type("text/html").send(renderDigestHtml(d));
  });
  app.get("/steward/digest.txt", async (req, reply) => {
    const d = await digestFor(req, reply);
    if (!d) return;
    reply.type("text/plain").send(renderDigestText(d));
  });

  // Integrity check (M1.5) — an auditor or the founder can ask "has the record
  // been tampered with?" and get a straight answer. Recomputes the hash chain;
  // if a WORM anchor file is configured, also checks the head against it.
  //
  // Deliberately still open, and safe to be: it answers in row counts and
  // hashes and never names a repository, an actor, or a change. It is the same
  // kind of surface as /anchors.json — a third party has to be able to check
  // the chain WITHOUT credentials, or "verifiable" means "verifiable by us".
  app.get("/steward/integrity", async () => {
    const chain = await verifyAuditChain(pool);
    const sink = makeAnchor(config.anchor);
    const anchor = sink
      ? await verifyAgainstAnchor(pool, sink)
      : { status: "no-anchor" as const, detail: "no WORM anchor configured" };
    const ok = chain.intact && anchor.status !== "tampered";
    return { ok, chain, anchor };
  });

  // The repo health page (tier 3) — one pull-up chart. Folds the Steward's
  // vitals, the change log, and the integrity check into one view.
  //
  // One repository, always. The portfolio form used to be the default here and
  // it was the widest part of the leak; the signed-in equivalent already exists,
  // correctly scoped, at /api/me/overview.
  const healthFor = async (req: FastifyRequest, reply: FastifyReply) => {
    const repo = await resolveRepoScope(pool, req, reply);
    if (!repo) return null;
    const q = req.query as { days?: string };
    return buildHealthReport(pool, { repo, windowDays: intParam(q.days, 30, 1, 90) });
  };
  app.get("/steward/health", async (req, reply) => {
    const r = await healthFor(req, reply);
    return r ?? undefined;
  });
  app.get("/steward/health.html", async (req, reply) => {
    const r = await healthFor(req, reply);
    if (!r) return;
    reply.type("text/html").send(renderHealthHtml(r));
  });

  registerAppRoutes(app, pool);
  registerAuthRoutes(app, pool);
  registerSteward(app, pool);
  registerApi(app, pool);
  // V4: the public read surface of the write-once anchor store.
  registerAnchors(
    app,
    makeAnchor(config.anchor),
    config.anchor.s3Bucket
      ? `s3://${config.anchor.s3Bucket}/${config.anchor.s3Prefix ?? ""}anchors/ (Object Lock, compliance mode)`
      : config.anchor.file
        ? `append-only file: ${config.anchor.file}`
        : null
  );
  return app;
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const app = buildServer(pool);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  // Periodic jobs (anchor nightly, digest weekly) run in-process when enabled —
  // on exactly one instance, so a job never double-fires.
  if (config.scheduler) startScheduler(pool, {}, { log: (l) => app.log.info(l) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
