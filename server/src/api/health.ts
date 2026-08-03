// The site's Phase 2 API module seam. Separate from steward/ (different auth:
// user auth here, GitHub App tokens there), shared process + Postgres, separate
// schema. M1 ships only health; the real API grows here.
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";

export function registerApi(app: FastifyInstance, pool: Pool) {
  app.get("/api/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true, module: "api" };
  });
}
