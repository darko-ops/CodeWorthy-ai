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

/**
 * A branch: more than one row chains onto the same parent.
 *
 * Reported at the PARENT, listing its children, because "which child is the
 * real continuation and which is the stray" has no order-independent answer —
 * when both are leaves it is a coin toss, and a verifier must not report a coin
 * toss as a finding. The fact that matters is that the parent has more than one
 * child, and every one of them that nothing chains onto is unprotected.
 */
export interface ChainFork {
  parentSeq: string;    // the row they all chain onto
  childSeqs: string[];  // the rows that chain onto it, by id
}

export interface ChainVerification {
  /** Content verified AND every link resolves to a real row. A fork does not
   *  make the record un-intact — see the note on verifyAuditChain. */
  intact: boolean;
  checked: number;
  brokenAtSeq?: string; // first row that fails; absent when intact
  reason?: "content" | "linkage"; // content = a field was altered; linkage = a row was removed/reordered
  /** Concurrency branches: valid hashes, non-linear shape. Reported, not failed. */
  forks?: ChainFork[];
}

// Recompute every row's hash from its content + the ACTUAL previous row's hash,
// and flag the first divergence. One SQL pass; each row is recomputed under the
// canonical version it was WRITTEN with (audit_canonical for v1 rows,
// audit_canonical_v2 for v2) — the DB's own functions are the shared source of
// truth so the recompute matches the trigger exactly, and a canonical upgrade
// never orphans existing history.
export async function verifyAuditChain(pool: Pool): Promise<ChainVerification> {
  // ── 1. CONTENT: was any field altered after it was recorded? ──────────────
  //
  // Recomputed from each row's OWN stored prev_hash. The earlier version used
  // the positional `lag(row_hash) OVER (ORDER BY id)` instead, which silently
  // assumed id order IS chain order — so when a concurrent append branched the
  // chain, every row past the branch looked content-altered as well as
  // mis-linked, and the endpoint reported tampering where none had occurred.
  // Using the stored prev_hash asks the one question that is actually about
  // content, and answers it whatever shape the chain is in.
  const content = await pool.query(
    `SELECT id::text AS seq FROM audit_events a
      WHERE a.row_hash IS DISTINCT FROM digest(
        coalesce(a.prev_hash, '\\x'::bytea) ||
        CASE a.canon_version
          WHEN 2 THEN audit_canonical_v2(a.id, a.ts, a.installation_id, a.repo, a.event_type, a.actor, a.payload, a.plain_english)
          ELSE        audit_canonical   (a.id, a.ts, a.installation_id, a.repo, a.event_type, a.actor, a.payload, a.plain_english)
        END, 'sha256')
      ORDER BY a.id LIMIT 1`
  );
  const { rows: totalRows } = await pool.query(`SELECT count(*)::int AS n FROM audit_events`);
  const checked: number = totalRows[0].n;
  if (content.rowCount) {
    return { intact: false, checked, brokenAtSeq: content.rows[0].seq, reason: "content" };
  }

  // ── 2. STRUCTURE: does every link land on a row that exists? ──────────────
  //
  // This is what separates an attack from a race, and the distinction is
  // rigorous rather than convenient. Removing or reordering rows leaves some
  // prev_hash pointing at a hash no row carries — nothing can forge that
  // without recomputing everything after it (which is the anchor layer's job to
  // catch). A concurrent append, by contrast, produces a perfectly valid hash
  // tree that merely branches: every pointer still resolves.
  const dangling = await pool.query(
    `SELECT a.id::text AS seq FROM audit_events a
      WHERE a.prev_hash IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM audit_events p WHERE p.row_hash = a.prev_hash)
      ORDER BY a.id LIMIT 1`
  );
  if (dangling.rowCount) {
    return { intact: false, checked, brokenAtSeq: dangling.rows[0].seq, reason: "linkage" };
  }

  // ── 3. FORKS: valid, but not linear. Named, never hidden. ─────────────────
  //
  // Two rows chaining onto the same parent. Reported so an auditor sees it —
  // the younger sibling is a leaf nothing commits to, so it does NOT enjoy the
  // "can't be changed without breaking a later link" property the rest of the
  // chain has, and saying so is the honest position.
  const forks = await pool.query(
    `SELECT p.id::text AS parent_seq,
            array_agg(a.id::text ORDER BY a.id) AS child_seqs
       FROM audit_events a
       JOIN audit_events p ON p.row_hash = a.prev_hash
      WHERE a.prev_hash IS NOT NULL
      GROUP BY p.id
     HAVING count(*) > 1
      ORDER BY p.id`
  );
  return {
    intact: true,
    checked,
    ...(forks.rowCount
      ? { forks: forks.rows.map((r) => ({ parentSeq: r.parent_seq, childSeqs: r.child_seqs as string[] })) }
      : {}),
  };
}

/** One sentence about the chain, for the places that render it to a human. */
export function describeChain(c: ChainVerification): string {
  if (!c.intact) return `broken at entry ${c.brokenAtSeq} (${c.reason})`;
  if (!c.forks?.length) return `intact (${c.checked} entries)`;
  const n = c.forks.length;
  const where = c.forks.map((f) => `${f.childSeqs.join(" and ")} both chain onto ${f.parentSeq}`).join("; ");
  return `intact (${c.checked} entries; ${n} concurrency ${n === 1 ? "fork" : "forks"} — ${where}; no content altered)`;
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
// recent anchor (or null); list() returns every anchor oldest-first (V2 — the
// evidence package ships the anchors covering its segment so a verifier can
// check them against an independently fetched copy). Implementations:
// InMemoryAnchor (tests), FileAnchor (dev/self-host, append-only file),
// S3ObjectLockAnchor (prod — documented).
export interface Anchor {
  append(rec: AnchorRecord): Promise<void>;
  latest(): Promise<AnchorRecord | null>;
  list(): Promise<AnchorRecord[]>;
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

// Resolve the configured anchor: S3 (prod) > file (dev) > none. Kept here so the
// server and the anchor job pick the same one from the same config.
export function makeAnchor(cfg: {
  s3Bucket?: string;
  s3Prefix?: string;
  s3Region?: string;
  retentionDays?: number;
  file?: string;
}): Anchor | null {
  if (cfg.s3Bucket) {
    return new S3ObjectLockAnchor({
      bucket: cfg.s3Bucket,
      prefix: cfg.s3Prefix || undefined,
      region: cfg.s3Region || undefined,
      retentionDays: cfg.retentionDays,
    });
  }
  if (cfg.file) return new FileAnchor(cfg.file);
  return null;
}

// ── Anchor implementations ─────────────────────────────────────────────────

// For tests and single-process dev. Not durable — a real anchor is external.
export class InMemoryAnchor implements Anchor {
  private recs: AnchorRecord[] = [];
  append(rec: AnchorRecord): Promise<void> { this.recs.push(rec); return Promise.resolve(); }
  latest(): Promise<AnchorRecord | null> { return Promise.resolve(this.recs.at(-1) ?? null); }
  list(): Promise<AnchorRecord[]> { return Promise.resolve([...this.recs]); }
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
    const all = await this.list();
    return all.at(-1) ?? null;
  }
  async list(): Promise<AnchorRecord[]> {
    const { readFile } = await import("node:fs/promises");
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as AnchorRecord);
  }
}

// Prod: the real root of trust. Each anchor is a PUT to an S3 bucket whose
// objects are under Object Lock in COMPLIANCE mode — write-once, undeletable and
// unoverwritable for the retention window, even by the account root. That is
// what makes a full consistent rewrite of audit_events provably detectable: the
// previously-anchored head still exists, outside the DB, beyond reach.
//
// The transport is injectable (S3Like) so the wiring — key scheme, the Object
// Lock params, latest-selection — is unit-tested offline against a fake. In prod
// the real S3Client is built lazily from the default AWS credential chain (an
// instance/task role — no secrets in env). The @aws-sdk/client-s3 command
// classes are dynamic-imported so a deployment that never sets a bucket doesn't
// pay to load them.

// The one method we use off the S3 client — kept narrow so a fake is trivial.
export interface S3Like {
  send(command: unknown): Promise<any>;
}

export interface S3AnchorOptions {
  bucket: string;
  prefix?: string; // key prefix, e.g. "codeworthy/"; default ""
  region?: string; // else the SDK's default resolution
  retentionDays?: number; // Object Lock compliance window; default 10 years
  client?: S3Like; // injected in tests; else a real S3Client is built lazily
  now?: () => Date; // injectable clock for the retain-until date
}

// Anchor keys are zero-padded so lexical order (how S3 lists) equals chain
// order, making latest() a max-key scan rather than a fetch-and-compare of every
// record.
const SEQ_WIDTH = 20;
const anchorKey = (prefix: string, seq: string) => `${prefix}anchors/${seq.padStart(SEQ_WIDTH, "0")}.json`;

export class S3ObjectLockAnchor implements Anchor {
  private client: S3Like | null;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly region?: string;
  private readonly retentionDays: number;
  private readonly now: () => Date;

  constructor(opts: S3AnchorOptions) {
    this.bucket = opts.bucket;
    this.prefix = opts.prefix ?? "";
    this.region = opts.region;
    this.retentionDays = opts.retentionDays ?? 3650;
    this.now = opts.now ?? (() => new Date());
    this.client = opts.client ?? null;
  }

  private async s3(): Promise<S3Like> {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client(this.region ? { region: this.region } : {}) as unknown as S3Like;
    }
    return this.client;
  }

  async append(rec: AnchorRecord): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.s3();
    const retainUntil = new Date(this.now().getTime() + this.retentionDays * 86_400_000);
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: anchorKey(this.prefix, rec.seq),
        Body: JSON.stringify(rec),
        ContentType: "application/json",
        // Write-once for the retention window — the whole point.
        ObjectLockMode: "COMPLIANCE",
        ObjectLockRetainUntilDate: retainUntil,
        // Don't clobber an existing anchor at this seq (they must never change).
        IfNoneMatch: "*",
      })
    );
  }

  private async listKeys(): Promise<string[]> {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = await this.s3();
    const listPrefix = `${this.prefix}anchors/`;
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: listPrefix, ContinuationToken: token })
      );
      for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return keys.sort(); // zero-padded keys: lexical order == chain order
  }

  private async fetch(key: string): Promise<AnchorRecord> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.s3();
    const got = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return JSON.parse(await got.Body.transformToString()) as AnchorRecord;
  }

  async latest(): Promise<AnchorRecord | null> {
    const keys = await this.listKeys();
    const maxKey = keys.at(-1);
    return maxKey ? this.fetch(maxKey) : null;
  }

  async list(): Promise<AnchorRecord[]> {
    const keys = await this.listKeys();
    const out: AnchorRecord[] = [];
    for (const k of keys) out.push(await this.fetch(k));
    return out;
  }
}
