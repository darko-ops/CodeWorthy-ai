import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "./audit.js";
import {
  anchorAuditHead,
  chainHead,
  InMemoryAnchor,
  verifyAgainstAnchor,
  verifyAuditChain,
} from "./tamper.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

// Tampering requires getting PAST the append-only trigger — exactly the insider
// scenario M1.5 exists to catch. As the table owner we can disable it; the
// hash chain is what makes the edit visible anyway.
async function withImmutabilityOff(fn: () => Promise<void>) {
  await pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_mutation");
  try { await fn(); } finally {
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_mutation");
  }
}

async function seed(n: number) {
  for (let i = 0; i < n; i++) {
    await appendAuditEvent(pool, {
      installationId: 1, repo: "acme/app", eventType: "push.direct_to_default",
      actor: `user${i}`, payload: { i }, plainEnglish: `event ${i}`,
    });
  }
}

describe("M1.5 hash chain — tamper evidence", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });
  afterAll(async () => { await pool.end(); });

  it("builds a linked chain on insert: genesis has no prev, each row links to the last", async () => {
    await seed(3);
    const { rows } = await pool.query(
      "SELECT id, prev_hash, row_hash FROM audit_events ORDER BY id"
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].prev_hash).toBeNull(); // genesis
    expect(rows[0].row_hash).not.toBeNull();
    // each row's prev_hash equals the previous row's row_hash
    expect(rows[1].prev_hash.equals(rows[0].row_hash)).toBe(true);
    expect(rows[2].prev_hash.equals(rows[1].row_hash)).toBe(true);
  });

  it("verifies an untampered chain as intact", async () => {
    await seed(4);
    const v = await verifyAuditChain(pool);
    expect(v.intact).toBe(true);
    expect(v.checked).toBe(4);
    expect(v.brokenAtSeq).toBeUndefined();
  });

  it("detects an in-place field edit (content) and names the row", async () => {
    await seed(4);
    const target = (await pool.query("SELECT id FROM audit_events ORDER BY id OFFSET 1 LIMIT 1")).rows[0].id;
    await withImmutabilityOff(async () => {
      await pool.query("UPDATE audit_events SET actor = 'tampered' WHERE id = $1", [target]);
    });
    const v = await verifyAuditChain(pool);
    expect(v.intact).toBe(false);
    expect(v.reason).toBe("content");
    expect(v.brokenAtSeq).toBe(String(target));
  });

  it("detects a deleted row (linkage break)", async () => {
    await seed(5);
    const mid = (await pool.query("SELECT id FROM audit_events ORDER BY id OFFSET 2 LIMIT 1")).rows[0].id;
    await withImmutabilityOff(async () => {
      await pool.query("DELETE FROM audit_events WHERE id = $1", [mid]);
    });
    const v = await verifyAuditChain(pool);
    expect(v.intact).toBe(false);
    expect(v.reason).toBe("linkage");
  });

  it("WORM anchor catches a FULL consistent rewrite the in-DB chain would miss", async () => {
    await seed(3);
    const anchor = new InMemoryAnchor();
    const anchored = await anchorAuditHead(pool, anchor);
    expect(anchored).not.toBeNull();
    expect(await verifyAgainstAnchor(pool, anchor)).toEqual({ status: "consistent", anchoredSeq: anchored!.seq });

    // The worst case: an insider truncates and rebuilds a fresh, internally
    // consistent chain (the trigger recomputes valid hashes on re-insert).
    await withImmutabilityOff(async () => {
      await pool.query("TRUNCATE audit_events");
    });
    await appendAuditEvent(pool, { installationId: 1, repo: "acme/app", eventType: "installation.created", actor: "attacker", payload: {}, plainEnglish: "rewritten history" });

    // The in-DB chain verifies — it's a valid chain, just not the real one.
    expect((await verifyAuditChain(pool)).intact).toBe(true);
    // The external anchor is what exposes it: the anchored head is gone.
    const against = await verifyAgainstAnchor(pool, anchor);
    expect(against.status).toBe("tampered");
    expect(against.detail).toMatch(/gone from the log/i);
  });

  it("anchorAuditHead returns null on an empty log, and reports the head otherwise", async () => {
    const anchor = new InMemoryAnchor();
    expect(await anchorAuditHead(pool, anchor)).toBeNull();
    await seed(2);
    const head = await chainHead(pool);
    expect(head!.count).toBe(2);
    const rec = await anchorAuditHead(pool, anchor);
    expect(rec!.rowHash).toBe(head!.rowHash);
    expect(rec!.anchoredAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});
