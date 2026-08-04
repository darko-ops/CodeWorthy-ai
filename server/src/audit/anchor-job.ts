// The WORM anchoring job (M1.5). A scheduled task — Fly cron / a scheduled
// GitHub workflow — runs this on an interval (e.g. nightly) to pin the audit
// chain's head to write-once storage. It also verifies the previous anchor
// still matches before writing a new one, so a scheduled run doubles as a
// tamper alarm: if the anchored head has drifted, the record was rewritten.
//
//   npm run anchor
//
// No-op (exit 0) when no anchor is configured, so it's safe to schedule before a
// bucket exists. Exit 2 signals detected tampering — a monitor should page on it.
import { Pool } from "pg";
import { config } from "../config.js";
import { anchorAuditHead, chainHead, makeAnchor, verifyAgainstAnchor, verifyAuditChain } from "./tamper.js";

export async function runAnchorJob(
  pool: Pool,
  anchor = makeAnchor(config.anchor) // injectable for tests; else the configured sink
): Promise<{ status: "no-anchor" | "anchored" | "tampered"; detail?: string }> {
  if (!anchor) return { status: "no-anchor" };

  // 1. Recompute the in-DB chain and check the prior anchor first. Anchoring a
  //    head we haven't verified would launder tampering into the record.
  const chain = await verifyAuditChain(pool);
  if (!chain.intact) {
    return { status: "tampered", detail: `hash chain broken at seq ${chain.brokenAtSeq} (${chain.reason})` };
  }
  const prior = await verifyAgainstAnchor(pool, anchor);
  if (prior.status === "tampered") return { status: "tampered", detail: prior.detail };

  // 2. Idempotent: if the head hasn't advanced since the last anchor, don't
  //    re-PUT — Object Lock (write-once) would reject the duplicate key anyway.
  const head = await chainHead(pool);
  if (!head) return { status: "anchored", detail: "empty log — nothing to anchor" };
  if (prior.status === "consistent" && prior.anchoredSeq === head.seq) {
    return { status: "anchored", detail: `head unchanged (seq ${head.seq}) — already anchored` };
  }

  // 3. Chain verifies and matches the last anchor — pin the new head.
  const rec = await anchorAuditHead(pool, anchor);
  return { status: "anchored", detail: `seq ${rec!.seq}, ${rec!.count} events` };
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const result = await runAnchorJob(pool);
    console.log(`[anchor] ${result.status}${result.detail ? `: ${result.detail}` : ""}`);
    if (result.status === "tampered") process.exit(2);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
