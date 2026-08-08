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
// and flag the first divergence. One SQL pass; each row is recomputed under the
// canonical version it was WRITTEN with (audit_canonical for v1 rows,
// audit_canonical_v2 for v2) — the DB's own functions are the shared source of
// truth so the recompute matches the trigger exactly, and a canonical upgrade
// never orphans existing history.
export async function verifyAuditChain(pool: Pool): Promise<ChainVerification> {
  const { rows } = await pool.query(
    `WITH chain AS (
       SELECT id, row_hash, prev_hash,
              lag(row_hash) OVER (ORDER BY id) AS actual_prev,
              digest(
                coalesce(lag(row_hash) OVER (ORDER BY id), '\\x'::bytea) ||
                CASE canon_version
                  WHEN 2 THEN audit_canonical_v2(id, ts, installation_id, repo, event_type, actor, payload, plain_english)
                  ELSE audit_canonical(id, ts, installation_id, repo, event_type, actor, payload, plain_english)
                END,
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
