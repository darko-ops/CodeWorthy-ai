// V2 — evidence package tests. The strongest test here is the verifier-style
// walk: starting from NOTHING but the package bytes, recompute every v2 row's
// hash with the independent canonical implementation and walk the chain end to
// end. That is exactly what codeworthy-verify (V3) will do; if this passes,
// the package format carries everything independent verification needs.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "../audit/audit.js";
import { isoToEpochMicros, rowHashV2 } from "../audit/canonical.js";
import { anchorAuditHead, FileAnchor, InMemoryAnchor } from "../audit/tamper.js";
import { buildEvidencePackage, packageEntries } from "./package.js";
import { tarGz, tarball } from "./tar.js";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const PERIOD = { from: new Date(NOW - 7 * DAY).toISOString(), to: new Date(NOW + DAY).toISOString() };

async function seed(repo: string, eventType: string, payload: unknown, plain: string) {
  return appendAuditEvent(pool, { installationId: 7, repo, eventType, actor: "dana", payload, plainEnglish: plain });
}

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await migrate(url);
  await pool.query("TRUNCATE audit_events");
  await pool.query("TRUNCATE coverage_windows");
});

describe("V2 — the evidence package", () => {
  it("verifier-style walk: every hash recomputes from package bytes alone, chained end to end", async () => {
    await seed("acme/app", "change.merged", { number: 1, mergeSha: "sha-1" }, "PR #1 merged.");
    await seed("acme/site", "pull_request.opened", { number: 9 }, "PR #9 opened."); // another repo — same chain
    await seed("acme/app", "exception.force_push", { branch: "main", head: "h1" }, "Exception: force push.");

    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const lines = pkg.files.get("events.jsonl")!.toString("utf8").trim().split("\n").map((l) => JSON.parse(l));
    const binding = JSON.parse(pkg.files.get("chain-binding.json")!.toString("utf8"));

    expect(lines).toHaveLength(3);
    let prev: string | null = binding.opening_prev_hash;
    for (const row of lines) {
      expect(row.prev_hash).toBe(prev); // linkage
      const recomputed = rowHashV2(row.prev_hash, {
        id: row.id,
        tsEpochMicros: isoToEpochMicros(row.ts),
        installationId: row.installation_id,
        repo: row.repo,
        eventType: row.event_type,
        actor: row.actor,
        payloadText: row.payload_text,
        plainEnglish: row.plain_english,
      });
      expect(recomputed).toBe(row.row_hash); // content — recomputed, not trusted
      prev = row.row_hash;
    }
    expect(prev).toBe(binding.closing_row_hash);
    expect(binding.row_count).toBe(3);
  });

  it("manifest hashes every file correctly, and the bytes are reproducible run to run", async () => {
    await seed("acme/app", "change.merged", { number: 1, mergeSha: "s" }, "PR #1 merged.");
    const a = await buildEvidencePackage(pool, { ...PERIOD });
    const b = await buildEvidencePackage(pool, { ...PERIOD });

    for (const [name, hash] of Object.entries(a.manifest.files as Record<string, string>)) {
      expect(createHash("sha256").update(a.files.get(name)!).digest("hex")).toBe(hash);
    }
    // reproducibility: identical bytes, file by file — including the manifest
    expect([...a.files.keys()].sort()).toEqual([...b.files.keys()].sort());
    for (const name of a.files.keys()) {
      expect(a.files.get(name)!.equals(b.files.get(name)!), `file ${name} differs between runs`).toBe(true);
    }
    // and the tarball too
    expect(tarGz(packageEntries(a)).equals(tarGz(packageEntries(b)))).toBe(true);
  });

  it("carries EVERY event in the period — llm advisory events included, labeled, never filtered", async () => {
    await seed("acme/app", "llm.reviewed", { number: 3, provenance: { model: "claude-opus-5" } }, "AI review left 1 note.");
    await seed("acme/app", "change.merged", { number: 3, mergeSha: "s3" }, "PR #3 merged.");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const types = pkg.files.get("events.jsonl")!.toString("utf8").trim().split("\n").map((l) => JSON.parse(l).event_type);
    expect(types).toContain("llm.reviewed");
    // and the README states its advisory status
    expect(pkg.files.get("README.txt")!.toString("utf8")).toMatch(/llm\.\* are AI advisory notes/);
    expect(pkg.files.get("README.txt")!.toString("utf8")).toMatch(/never\s+constitute/i);
  });

  it("includes anchors covering the segment and points at the independent source", async () => {
    await seed("acme/app", "change.merged", { number: 1, mergeSha: "s" }, "PR #1 merged.");
    const anchor = new InMemoryAnchor();
    await anchorAuditHead(pool, anchor); // pins the current head — inside the segment
    await seed("acme/app", "change.merged", { number: 2, mergeSha: "s2" }, "PR #2 merged.");

    const pkg = await buildEvidencePackage(pool, { ...PERIOD, anchor, anchorSource: "s3://acme-anchors/anchors/ (Object Lock)" });
    const anchors = JSON.parse(pkg.files.get("anchors.json")!.toString("utf8"));
    expect(anchors.records).toHaveLength(1);
    expect(anchors.independent_source).toMatch(/s3:\/\/acme-anchors/);
    expect(anchors.note).toMatch(/prove nothing about the package/);
    // the anchored row is in the segment, so the verifier can check it
    const ids = pkg.files.get("events.jsonl")!.toString("utf8").trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toContain(anchors.records[0].seq);
  });

  it("derived views: reconciliation statements, coverage windows, and the exception register", async () => {
    await pool.query(
      `INSERT INTO coverage_windows (repo, installation_id, covered_from, covered_to, source)
       VALUES ('acme/app', 7, $1, NULL, 'installation.created')`,
      [new Date(NOW - 30 * DAY).toISOString()]
    );
    await seed("acme/app", "exception.merged_red_checks", { number: 4, redChecks: ["ci"] }, "Exception: merged on red.");
    await seed("acme/app", "reconciliation.completed", { accountedMergedPrs: 1 }, "Reconciliation: 0 unexplained discrepancies.");

    const pkg = await buildEvidencePackage(pool, { ...PERIOD, repos: ["acme/app"] });
    const recon = JSON.parse(pkg.files.get("reconciliation.json")!.toString("utf8"));
    expect(recon.derived).toBe(true);
    expect(recon.statements).toHaveLength(1);
    expect(recon.statements[0].statement).toMatch(/0 unexplained/);
    expect(recon.coverage_windows["acme/app"]).toHaveLength(1);
    const exc = JSON.parse(pkg.files.get("exceptions.json")!.toString("utf8"));
    expect(exc.exceptions).toHaveLength(1);
    expect(exc.exceptions[0].type).toBe("exception.merged_red_checks");
  });

  it("an empty period yields an honest empty package, not an error", async () => {
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    expect(pkg.rowCount).toBe(0);
    const binding = JSON.parse(pkg.files.get("chain-binding.json")!.toString("utf8"));
    expect(binding.first_seq).toBeNull();
    expect(binding.row_count).toBe(0);
  });

  it("tar.gz round-trips and contains the manifest bytes verbatim", async () => {
    await seed("acme/app", "change.merged", { number: 1, mergeSha: "s" }, "PR #1 merged.");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const tarBytes = gunzipSync(tarGz(packageEntries(pkg)));
    // the manifest's exact bytes appear inside the archive
    expect(tarBytes.includes(pkg.files.get("manifest.json")!)).toBe(true);
    // ustar magic present
    expect(tarBytes.subarray(257, 262).toString("ascii")).toBe("ustar");
  });

  it("tar checksums are valid for every header", async () => {
    const t = tarball([
      { name: "a.txt", content: Buffer.from("hello") },
      { name: "b.txt", content: Buffer.from("world!") },
    ]);
    for (let off = 0; off + 512 <= t.length; off += 512) {
      const block = t.subarray(off, off + 512);
      if (block.every((b) => b === 0)) break; // end-of-archive
      if (block.subarray(257, 262).toString("ascii") !== "ustar") continue; // data block
      const stated = parseInt(block.subarray(148, 156).toString("ascii").replace(/\0.*$/, "").trim(), 8);
      const copy = Buffer.from(block);
      copy.fill(0x20, 148, 156);
      let sum = 0;
      for (const b of copy) sum += b;
      expect(sum).toBe(stated);
    }
  });
});

describe("V2 — Anchor.list()", () => {
  it("FileAnchor lists all records oldest-first and tolerates a missing file", async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "cw-anchor-"));
    const fa = new FileAnchor(join(dir, "anchors.jsonl"));
    expect(await fa.list()).toEqual([]);
    await fa.append({ seq: "1", rowHash: "aa", count: 1, anchoredAt: "2026-01-01T00:00:00Z" });
    await fa.append({ seq: "5", rowHash: "bb", count: 5, anchoredAt: "2026-02-01T00:00:00Z" });
    const all = await fa.list();
    expect(all.map((r) => r.seq)).toEqual(["1", "5"]);
    expect(await fa.latest()).toMatchObject({ seq: "5" });
  });
});
