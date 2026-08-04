import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "./audit.js";
import {
  S3ObjectLockAnchor,
  makeAnchor,
  verifyAgainstAnchor,
  type AnchorRecord,
  type S3Like,
} from "./tamper.js";
import { runAnchorJob } from "./anchor-job.js";

// Note: runAnchorJob takes an injectable anchor so these tests never touch AWS.

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

// A fake S3 that speaks the same commands the real client does — no network. It
// stores objects, refuses to overwrite a locked key (IfNoneMatch), and answers
// ListObjectsV2/GetObject the way S3 does, so the anchor's wiring is exercised
// exactly as it would be in prod.
class FakeS3 implements S3Like {
  store = new Map<string, string>();
  puts: any[] = [];
  send(command: any): Promise<any> {
    const name = command.constructor.name;
    const i = command.input;
    if (name === "PutObjectCommand") {
      if (i.IfNoneMatch === "*" && this.store.has(i.Key)) {
        return Promise.reject(new Error("PreconditionFailed: object exists (Object Lock)"));
      }
      this.puts.push(i);
      this.store.set(i.Key, String(i.Body));
      return Promise.resolve({});
    }
    if (name === "ListObjectsV2Command") {
      const keys = [...this.store.keys()].filter((k) => k.startsWith(i.Prefix)).sort();
      return Promise.resolve({ Contents: keys.map((Key) => ({ Key })), IsTruncated: false });
    }
    if (name === "GetObjectCommand") {
      const body = this.store.get(i.Key)!;
      return Promise.resolve({ Body: { transformToString: () => Promise.resolve(body) } });
    }
    throw new Error(`unexpected command ${name}`);
  }
}

const rec = (seq: string, hash: string): AnchorRecord => ({ seq, rowHash: hash, count: Number(seq), anchoredAt: "2026-01-01T00:00:00.000Z" });

describe("M1.5 S3 Object Lock anchor", () => {
  it("PUTs under a zero-padded key with COMPLIANCE lock and a retention date", async () => {
    const s3 = new FakeS3();
    const anchor = new S3ObjectLockAnchor({ bucket: "cw-audit", prefix: "acme/", client: s3, retentionDays: 30, now: () => new Date("2026-01-01T00:00:00Z") });
    await anchor.append(rec("42", "deadbeef"));

    expect(s3.puts).toHaveLength(1);
    const put = s3.puts[0];
    expect(put.Bucket).toBe("cw-audit");
    expect(put.Key).toBe("acme/anchors/00000000000000000042.json"); // padded -> lexical == chain order
    expect(put.ObjectLockMode).toBe("COMPLIANCE");
    expect(put.IfNoneMatch).toBe("*"); // never clobber an anchored head
    // retention = now + 30 days
    expect(new Date(put.ObjectLockRetainUntilDate).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(JSON.parse(put.Body).rowHash).toBe("deadbeef");
  });

  it("latest() returns the highest-seq anchor across many objects", async () => {
    const s3 = new FakeS3();
    const anchor = new S3ObjectLockAnchor({ bucket: "cw-audit", client: s3 });
    await anchor.append(rec("5", "h5"));
    await anchor.append(rec("40", "h40"));
    await anchor.append(rec("9", "h9"));
    const latest = await anchor.latest();
    expect(latest!.seq).toBe("40"); // not "9" — padded keys sort numerically
    expect(latest!.rowHash).toBe("h40");
  });

  it("latest() is null on an empty bucket", async () => {
    const anchor = new S3ObjectLockAnchor({ bucket: "cw-audit", client: new FakeS3() });
    expect(await anchor.latest()).toBeNull();
  });

  it("makeAnchor prefers S3 when a bucket is set", () => {
    expect(makeAnchor({ s3Bucket: "b", file: "/tmp/x" })).toBeInstanceOf(S3ObjectLockAnchor);
    expect(makeAnchor({ file: "" })).toBeNull();
  });
});

describe("M1.5 anchor job against S3", () => {
  beforeEach(async () => { await migrate(url); await pool.query("TRUNCATE audit_events"); });
  afterAll(async () => { await pool.end(); });

  async function seed(n: number) {
    for (let i = 0; i < n; i++) await appendAuditEvent(pool, { installationId: 1, repo: "acme/app", eventType: "push.direct_to_default", actor: `u${i}`, payload: { i }, plainEnglish: `e${i}` });
  }

  it("runAnchorJob anchors the head to S3, then re-verifies consistent", async () => {
    await seed(3);
    const anchor = new S3ObjectLockAnchor({ bucket: "cw-audit", client: new FakeS3() });

    const first = await runAnchorJob(pool, anchor);
    expect(first.status).toBe("anchored");
    expect(first.detail).toMatch(/3 events/);

    // a second run verifies the prior anchor still matches before re-anchoring
    const second = await runAnchorJob(pool, anchor);
    expect(second.status).toBe("anchored");
    expect(await verifyAgainstAnchor(pool, anchor)).toMatchObject({ status: "consistent" });
  });

  it("runAnchorJob reports tampered (and does not anchor) after a full rewrite", async () => {
    await seed(2);
    const anchor = new S3ObjectLockAnchor({ bucket: "cw-audit", client: new FakeS3() });
    await runAnchorJob(pool, anchor); // pin seq=2 head to S3

    // Rewrite history: truncate and rebuild a fresh, internally valid chain.
    await pool.query("ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_mutation");
    await pool.query("TRUNCATE audit_events");
    await pool.query("ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_mutation");
    await appendAuditEvent(pool, { installationId: 1, repo: "acme/app", eventType: "installation.created", actor: "attacker", payload: {}, plainEnglish: "rewritten" });

    // The job refuses to launder it: the S3-anchored head is gone -> tampered.
    const result = await runAnchorJob(pool, anchor);
    expect(result.status).toBe("tampered");
    expect(result.detail).toMatch(/gone from the log/i);
  });
});
