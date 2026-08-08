// The cross-implementation drift guard (V0.1).
//
// Rows written by the DB trigger (audit_canonical_v2, SQL) are recomputed here
// by the TypeScript reimplementation (canonical.ts) from raw field values. If
// the two implementations ever disagree — a field reordered, an encoding
// changed, a separator tweaked — this test fails, BEFORE a standalone verifier
// in the field starts reporting false tampering. This is the contract the
// "verification is independent" invariant rests on.
//
// Also proves the versioning promise: v1 rows (written before 0003) keep
// verifying under the mixed-version chain walk.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "./audit.js";
import { verifyAuditChain } from "./tamper.js";
import { canonicalV2, isoToEpochMicros, rowHashV2, SEPARATOR } from "./canonical.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

afterAll(async () => { await pool.end(); });
beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });

// Read a row back in exactly the export representation the verifier will get:
// ISO-with-microseconds timestamp, Postgres-normalized payload text, hex hashes.
async function exportRow(id: string) {
  const { rows } = await pool.query(
    `SELECT id::text AS id,
            to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ts_iso,
            installation_id::text AS installation_id,
            repo, event_type, actor,
            payload::text AS payload_text,
            plain_english,
            canon_version,
            encode(prev_hash, 'hex') AS prev_hash,
            encode(row_hash, 'hex') AS row_hash
     FROM audit_events WHERE id = $1`,
    [id]
  );
  return rows[0];
}

// Payloads chosen to stress the jsonb-normalization surface: unicode, nesting,
// numbers in different shapes, nulls, empty containers, key ordering.
const TRICKY_PAYLOADS: unknown[] = [
  {},
  { b: 1, a: 2 }, // jsonb reorders keys — export text is what's hashed
  { note: "héllo — ünïcode ✓", n: null },
  { nested: { deep: [1, 2.5, "three", false, null] }, zero: 0 },
  { big: 123456789012345, neg: -1.25, exp: 1000 },
  { longKey_aaaaaaaaaaaaaaaaaaaaaaaa: "x", z: "y", a: "w" }, // length-then-byte key order
];

describe("canonical v2 — cross-implementation drift guard", () => {
  it("TS recomputes the DB trigger's hashes byte-for-byte, across tricky payloads", async () => {
    let expectPrev: string | null = null;
    for (const [i, payload] of TRICKY_PAYLOADS.entries()) {
      const id = await appendAuditEvent(pool, {
        installationId: i % 2 === 0 ? 7 : null, // alternate null/non-null
        repo: "acme/app",
        eventType: "test.canonical",
        actor: i % 3 === 0 ? null : "dana",
        payload,
        plainEnglish: `canonical drift row ${i} — “quotes”, emoji 🧭, and a	tab`,
      });
      const row = await exportRow(id);
      expect(row.canon_version).toBe(2); // new rows are v2

      const recomputed = rowHashV2(row.prev_hash, {
        id: row.id,
        tsEpochMicros: isoToEpochMicros(row.ts_iso),
        installationId: row.installation_id,
        repo: row.repo,
        eventType: row.event_type,
        actor: row.actor,
        payloadText: row.payload_text,
        plainEnglish: row.plain_english,
      });
      expect(recomputed).toBe(row.row_hash);
      expect(row.prev_hash).toBe(expectPrev); // linkage matches what we saw
      expectPrev = row.row_hash;
    }
  });

  it("canonical bytes have exactly 7 separators and match a known vector", () => {
    const bytes = canonicalV2({
      id: "1",
      tsEpochMicros: "1754630400000000", // a fixed instant (2025-08-08T05:20:00Z)
      installationId: null,
      repo: "acme/app",
      eventType: "test.vector",
      actor: null,
      payloadText: "{}",
      plainEnglish: "vector row",
    });
    const seps = [...bytes].filter((b) => b === 0x1f).length;
    expect(seps).toBe(7);
    // The spec's published vector (docs/spec/canonical-encoding.md §vectors).
    expect(bytes.toString("utf8")).toBe(
      ["1", "1754630400000000", "", "acme/app", "test.vector", "", "{}", "vector row"].join(SEPARATOR)
    );
  });

  it("isoToEpochMicros is exact string arithmetic, no float error", () => {
    expect(isoToEpochMicros("2026-08-08T05:20:00.000001Z")).toBe("1786166400000001");
    expect(isoToEpochMicros("2026-08-08T05:20:00.123456Z")).toBe("1786166400123456");
    expect(isoToEpochMicros("2026-08-08T05:20:00Z")).toBe("1786166400000000");
    expect(isoToEpochMicros("1970-01-01T00:00:00.000000Z")).toBe("0");
    expect(() => isoToEpochMicros("2026-08-08 05:20:00")).toThrow(/not a supported/);
  });

  it("v1 rows written before the migration keep verifying (mixed-version chain)", async () => {
    // Simulate a pre-0003 row: bypass both triggers and write a v1 genesis row
    // hashed exactly the way the 0002-era trigger would have (v1 canonical,
    // canon_version 1, prev NULL).
    await pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_chain");
    await pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_mutation");
    await pool.query(
      `INSERT INTO audit_events (installation_id, repo, event_type, actor, payload, plain_english, canon_version, prev_hash)
       VALUES (7, 'acme/app', 'test.v1row', 'dana', '{"legacy": true}'::jsonb, 'a v1-era row', 1, NULL)`
    );
    await pool.query(
      `UPDATE audit_events
       SET row_hash = digest(
             '\\x'::bytea || audit_canonical(id, ts, installation_id, repo, event_type, actor, payload, plain_english),
             'sha256')
       WHERE event_type = 'test.v1row'`
    );
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_mutation");
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_chain");

    // Now append normal v2 rows on top of the v1 genesis.
    await appendAuditEvent(pool, { installationId: 7, repo: "acme/app", eventType: "test.after", actor: "dana", payload: { i: 1 }, plainEnglish: "v2 row on v1 base" });
    await appendAuditEvent(pool, { installationId: null, repo: "acme/app", eventType: "test.after", actor: null, payload: {}, plainEnglish: "another v2 row" });

    const check = await verifyAuditChain(pool);
    expect(check.intact).toBe(true);
    expect(check.checked).toBe(3);

    // And tampering with the v1 row is still caught by the mixed-version walk.
    await pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_mutation");
    await pool.query("UPDATE audit_events SET plain_english = 'rewritten history' WHERE event_type = 'test.v1row'");
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_mutation");
    const broken = await verifyAuditChain(pool);
    expect(broken.intact).toBe(false);
    expect(broken.reason).toBe("content");
  });
});
