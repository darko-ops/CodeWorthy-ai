// The published anchors endpoint (V4) — the public, read-only trust point.
//
// GET /anchors.json returns every write-once anchor record this deployment has
// pinned. Anyone — a customer's auditor, a monitor, a cron mirror — can fetch,
// pin, or diff it WITHOUT credentials, so verifying a package's anchors never
// requires trusting the package (or asking the operator for AWS access). This
// is the read surface of the root of trust, not the root itself: the store
// stays S3 Object Lock (compliance mode); this endpoint is how third parties
// see it. Mirror the URL wherever you publish your attestation public key.
import type { FastifyInstance } from "fastify";
import type { Anchor } from "../audit/tamper.js";

export function registerAnchors(app: FastifyInstance, anchor: Anchor | null, source: string | null) {
  app.get("/anchors.json", async (_req, reply) => {
    if (!anchor) {
      return reply.code(404).send({
        records: [],
        note: "No write-once anchor store is configured on this deployment; chain verification is internal-only.",
      });
    }
    const records = await anchor.list();
    return reply
      .header("cache-control", "public, max-age=300")
      .send({
        records,
        source,
        note: "Append-only anchor records: each pins the audit chain's head at the stated sequence. Compare these against any evidence package's anchors.json — they must match; a package can never legitimately disagree with this list.",
      });
  });
}
