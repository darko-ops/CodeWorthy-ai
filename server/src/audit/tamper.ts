// M1.5 — the tamper-evidence layer over the audit spine.
//
// The DB maintains a hash chain (see 0002_audit_hash_chain.sql). This module is
// the two things you do with it:
//
//   • verifyAuditChain() — recompute the chain in SQL (reusing the DB's own
//     audit_canonical(), so there's no second implementation to drift) and
//     return the first row where content or linkage breaks. Catches any edit,
//     delete, or reorder — even one made with the immutability trigger disabled.
//
//   • anchorAuditHead() / verifyAgainstAnchor() — pin the chain head to
//     write-once storage OUTSIDE the DB. This closes the one hole the in-DB
//     chain can't: an insider who rewrites every row AND recomputes the whole
//     chain stays internally consistent, but the head won't match what was
//     already anchored. The Anchor is an injectable seam; prod uses S3 Object
//     Lock (compliance mode — write-once, undeletable even by root).
import type { Pool } from "pg";

export interface ChainHead {
  seq: string; // the id of the newest row — the chain tip
  rowHash: string; // its row_hash, hex
  count: number; // total rows, so a truncation-and-rebuild changes the head
}

export interface ChainVerification {
  intact: boolean;
  checked: number;
  brokenAtSeq?: string; // first row that fails; absent when intact
  reason?: "content" | "linkage"; // content = a field was altered; linkage = a row was removed/reordered
}

// Recompute every row's hash from its content + the ACTUAL previous row's hash,
// and flag the first divergence. One SQL pass; audit_canonical() is the shared
// source of truth so the recompute matches the trigger exactly.
export async function verifyAuditChain(pool: Pool): Promise<ChainVerification> {
  const { rows } = await pool.query(
    `WITH chain AS (
       SELECT id, row_hash, prev_hash,
              lag(row_hash) OVER (ORDER BY id) AS actual_prev,
              digest(
                coalesce(lag(row_hash) OVER (ORDER BY id), '\\x'::bytea) ||
                audit_canonical(id, ts, installation_id, repo, event_type, actor, payload, plain_english),
                'sha256'
              ) AS recomputed
       FROM audit_events
     ), total AS (SELECT count(*)::int AS n FROM audit_events)
     SELECT id::text AS seq,
            (row_hash IS DISTINCT FROM recomputed) AS content_broken,
            (prev_hash IS DISTINCT FROM actual_prev) AS link_broken,
            (SELECT n FROM total) AS checked
     FROM chain
     WHERE row_hash IS DISTINCT FROM recomputed OR prev_hash IS DISTINCT FROM actual_prev
     ORDER BY id
     LIMIT 1`
  );
  if (rows.length === 0) {
    const c = await pool.query(`SELECT count(*)::int AS n FROM audit_events`);
    return { intact: true, checked: c.rows[0].n };
  }
  const r = rows[0];
  return {
    intact: false,
    checked: r.checked,
    brokenAtSeq: r.seq,
    // A broken physical link (stored prev_hash no longer matches the actual
    // predecessor) means a row was removed or reordered; otherwise a field on
    // this row was altered.
    reason: r.link_broken ? "linkage" : "content",
  };
}

export async function chainHead(pool: Pool): Promise<ChainHead | null> {
  const { rows } = await pool.query(
    `SELECT id::text AS seq, encode(row_hash, 'hex') AS row_hash,
            (SELECT count(*)::int FROM audit_events) AS count
     FROM audit_events ORDER BY id DESC LIMIT 1`
  );
  return rows.length ? { seq: rows[0].seq, rowHash: rows[0].row_hash, count: rows[0].count } : null;
}

// ── The external root of trust ─────────────────────────────────────────────

export interface AnchorRecord extends ChainHead {
  anchoredAt: string; // ISO timestamp
}

// Write-once storage. append() must never overwrite; latest() returns the most
// recent anchor (or null). Implementations: InMemoryAnchor (tests), FileAnchor
// (dev/self-host, append-only file), S3ObjectLockAnchor (prod — documented).
export interface Anchor {
  append(rec: AnchorRecord): Promise<void>;
  latest(): Promise<AnchorRecord | null>;
}

// Snapshot the current chain head and commit it to the anchor. Returns the
// record written, or null when there's nothing to anchor yet (empty log).
export async function anchorAuditHead(pool: Pool, anchor: Anchor): Promise<AnchorRecord | null> {
  const head = await chainHead(pool);
  if (!head) return null;
  const rec: AnchorRecord = { ...head, anchoredAt: new Date().toISOString() };
  await anchor.append(rec);
  return rec;
}

export interface AnchorVerification {
  status: "consistent" | "tampered" | "no-anchor";
  anchoredSeq?: string;
  detail?: string;
}

// Compare the newest anchor to the live table: the row at the anchored seq must
// still carry the anchored hash. If it's gone or changed, history at or before
// that point was rewritten — proven even if the in-DB chain now verifies.
export async function verifyAgainstAnchor(pool: Pool, anchor: Anchor): Promise<AnchorVerification> {
  const rec = await anchor.latest();
  if (!rec) return { status: "no-anchor" };
  const { rows } = await pool.query(
    `SELECT encode(row_hash, 'hex') AS row_hash FROM audit_events WHERE id = $1`,
    [rec.seq]
  );
  if (rows.length === 0) {
    return { status: "tampered", anchoredSeq: rec.seq, detail: `the anchored row (seq ${rec.seq}) is gone from the log` };
  }
  if (rows[0].row_hash !== rec.rowHash) {
    return { status: "tampered", anchoredSeq: rec.seq, detail: `the anchored row (seq ${rec.seq}) has a different hash than was anchored` };
  }
  return { status: "consistent", anchoredSeq: rec.seq };
}

// ── Anchor implementations ─────────────────────────────────────────────────

// For tests and single-process dev. Not durable — a real anchor is external.
export class InMemoryAnchor implements Anchor {
  private recs: AnchorRecord[] = [];
  append(rec: AnchorRecord): Promise<void> { this.recs.push(rec); return Promise.resolve(); }
  latest(): Promise<AnchorRecord | null> { return Promise.resolve(this.recs.at(-1) ?? null); }
  all(): AnchorRecord[] { return [...this.recs]; }
}

// Dev / self-host: an append-only JSONL file. Durable across restarts; still on
// the same host as the DB, so it's a weaker root of trust than S3 Object Lock —
// good enough for a design partner, not the compliance story. See below.
export class FileAnchor implements Anchor {
  constructor(private path: string) {}
  async append(rec: AnchorRecord): Promise<void> {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(this.path, JSON.stringify(rec) + "\n", "utf8");
  }
  async latest(): Promise<AnchorRecord | null> {
    const { readFile } = await import("node:fs/promises");
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    const lines = text.trim().split("\n").filter(Boolean);
    return lines.length ? (JSON.parse(lines.at(-1)!) as AnchorRecord) : null;
  }
}

// Prod: the real root of trust. Each anchor is a PUT to an S3 bucket whose
// objects are under Object Lock in COMPLIANCE mode — write-once, undeletable and
// unoverwritable for the retention window, even by the account root. That is
// what makes a full consistent rewrite of audit_events provably detectable: the
// previously-anchored head still exists, outside the DB, beyond reach.
// Deliberately not wired here — it needs a bucket + IAM the deployment owns; the
// seam above (implement Anchor) is the whole integration surface.
//   e.g.  s3.putObject({ Bucket, Key: `anchors/${rec.seq}.json`,
//                        Body: JSON.stringify(rec), ObjectLockMode: "COMPLIANCE",
//                        ObjectLockRetainUntilDate: <now + retention> })
