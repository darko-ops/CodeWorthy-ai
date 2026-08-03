// CodeWorthy backend service entry. One deployment, two bounded modules:
// steward/ (GitHub App webhook + audit) and api/ (site backend seed). Shared
// Pool; separate schemas keep them cleanly splittable later.
import Fastify from "fastify";
import { Pool } from "pg";
import { config } from "./config.js";
import { registerApi } from "./api/health.js";
import { registerSteward } from "./steward/routes.js";
import { recentChangelog } from "./audit/audit.js";

export function buildServer(pool: Pool) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));

  // The plain-language change log — founder digest + auditor evidence.
  app.get("/steward/changelog", async (req) => {
    const q = req.query as { repo?: string; limit?: string };
    return recentChangelog(pool, { repo: q.repo, limit: q.limit ? parseInt(q.limit, 10) : undefined });
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
