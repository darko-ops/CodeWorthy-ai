// CodeWorthy backend service entry. One deployment, two bounded modules:
// steward/ (GitHub App webhook + audit) and api/ (site backend seed). Shared
// Pool; separate schemas keep them cleanly splittable later.
import Fastify from "fastify";
import { Pool } from "pg";
import { config } from "./config.js";
import { registerApi } from "./api/health.js";
import { registerSteward } from "./steward/routes.js";
import { recentChangelog } from "./audit/audit.js";
import { buildDigest } from "./digest/digest.js";
import { renderDigestHtml, renderDigestText } from "./digest/render.js";

export function buildServer(pool: Pool) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // The plain-language change log — founder digest + auditor evidence.
  app.get("/steward/changelog", async (req) => {
    const q = req.query as { repo?: string; limit?: string };
    return recentChangelog(pool, { repo: q.repo, limit: q.limit ? parseInt(q.limit, 10) : undefined });
  });

  // The weekly digest — the founder-facing artifact (and the auditor's evidence).
  const digestOpts = (q: { repo?: string; days?: string }) => ({
    repo: q.repo,
    periodDays: q.days ? parseInt(q.days, 10) : 7,
  });
  app.get("/steward/digest", async (req) => buildDigest(pool, digestOpts(req.query as any)));
  app.get("/steward/digest.html", async (req, reply) => {
    const d = await buildDigest(pool, digestOpts(req.query as any));
    reply.type("text/html").send(renderDigestHtml(d));
  });
  app.get("/steward/digest.txt", async (req, reply) => {
    const d = await buildDigest(pool, digestOpts(req.query as any));
    reply.type("text/plain").send(renderDigestText(d));
  });

  registerSteward(app, pool);
  registerApi(app, pool);
  return app;
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const app = buildServer(pool);
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
