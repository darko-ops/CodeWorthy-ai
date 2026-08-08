// The Steward webhook route. Verifies the signature over the RAW body, then
// dispatches to the audit spine. In M1 that's observe-and-log; M2 adds actions.
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { config } from "../config.js";
import { applyCoverageEvent } from "../audit/coverage.js";
import { handleEvent } from "./events.js";
import { runActions } from "./actions.js";
import { verifySignature } from "./webhook.js";

export function registerSteward(app: FastifyInstance, pool: Pool) {
  // Capture the raw body so the HMAC is computed over exactly what GitHub sent.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, { raw: body as string, json: JSON.parse(body as string) });
    } catch (err) {
      done(err as Error);
    }
  });

  app.post("/webhooks/github", async (req, reply) => {
    const parsed = req.body as { raw: string; json: any } | undefined;
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    if (!parsed || !verifySignature(config.github.webhookSecret, parsed.raw, signature)) {
      return reply.code(401).send({ error: "invalid signature" });
    }
    const eventName = (req.headers["x-github-event"] as string) ?? "unknown";
    const auditId = await handleEvent(pool, eventName, parsed.json);
    // Coverage windows (V0.4) transition in the same delivery that logged the
    // event, so the chained record and the window always corroborate.
    await applyCoverageEvent(pool, eventName, parsed.json).catch((err) => app.log.error({ err }, "coverage update failed"));
    // Actions run after logging; fire-and-forget so a mechanic failure or slow
    // GitHub call never fails the webhook (GitHub expects a fast 2xx).
    runActions(pool, eventName, parsed.json).catch((err) => app.log.error({ err }, "steward action failed"));
    return reply.code(202).send({ received: eventName, logged: auditId !== null, auditId });
  });
}
