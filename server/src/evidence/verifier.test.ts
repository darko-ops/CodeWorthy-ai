// V3 — mutant-package tests for the standalone verifier.
//
// Real packages are built from a real DB by the real exporter, then mutated
// one property at a time. Every mutant must fail (or downgrade) with the RIGHT
// message — a verifier that fails for the wrong reason teaches an auditor
// nothing. The verifier under test is the shipped one (verifier/src/*.mjs):
// zero dependencies, never imports server code; these tests exercise it purely
// through package bytes, exactly as an auditor would.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "../audit/audit.js";
import { anchorAuditHead, InMemoryAnchor } from "../audit/tamper.js";
import { buildEvidencePackage, packageEntries } from "./package.js";
import { tarGz } from "./tar.js";
import { untarGz } from "../../../verifier/src/untar.mjs";
import { verifyPackage } from "../../../verifier/src/verify.mjs";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const PERIOD = { from: new Date(NOW - 7 * DAY).toISOString(), to: new Date(NOW + DAY).toISOString() };

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function seed(repo: string, eventType: string, payload: unknown, plain: string) {
  return appendAuditEvent(pool, { installationId: 7, repo, eventType, actor: "dana", payload, plainEnglish: plain });
}

// A scenario that verifies CLEAN: approved merge, attested completeness with
// zero discrepancies, AI note with full provenance.
async function seedClean() {
  await seed("acme/app", "change.merged",
    { number: 1, mergeSha: "cafe12", headSha: "feed34", base: "main", author: "dana",
      approvers: [{ login: "raj", submittedAt: PERIOD.from }], selfApproved: false,
      approvalPrecededMerge: true, checksAtMerge: [{ name: "ci", conclusion: "success" }],
      redChecksAtMerge: [], evidenceGaps: [] },
    "PR #1 merged with 1 approval (raj); all 1 checks passing at merge.");
  await seed("acme/app", "llm.reviewed",
    { number: 1, findingCount: 0, provenance: { policyVersion: "abc123def456", model: "claude-opus-5", promptSha256: "0".repeat(64) } },
    "AI review found nothing to flag — advice only.");
  await seed("acme/app", "reconciliation.completed",
    { repo: "acme/app", expectedMergedPrs: 1, accountedMergedPrs: 1, discrepancies: [],
      uncoveredIntervals: [], truthTruncated: false, protectionState: "protected" },
    "Reconciliation for acme/app: GitHub reports 1 merged pull request(s) in the covered window; the log accounts for 1; 0 unexplained discrepancies.");
}

function mutate(files: Map<string, Buffer>, name: string, fn: (text: string) => string): void {
  files.set(name, Buffer.from(fn(files.get(name)!.toString("utf8")), "utf8"));
}

// After a deliberate chain mutation, re-align the manifest so the INTEGRITY
// check passes and the CHAIN check is what speaks.
function refreshManifest(files: Map<string, Buffer>): void {
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  for (const name of Object.keys(manifest.files)) manifest.files[name] = sha256(files.get(name)!);
  files.set("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8"));
}

const check = (report: ReturnType<typeof verifyPackage>, name: string) =>
  report.checks.find((c) => c.name === name)!;

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await migrate(url);
  await pool.query("TRUNCATE audit_events");
  await pool.query("TRUNCATE coverage_windows");
});

describe("V3 — codeworthy-verify on genuine packages", () => {
  it("a clean package verifies: every check passes, exit 0", async () => {
    await seedClean();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const report = verifyPackage(pkg.files);
    expect(report.checks.map((c) => [c.name, c.status])).toEqual([
      ["package-integrity", "pass"],
      ["chain", "pass"],
      ["anchors", "skip"], // none configured in this scenario
      ["completeness", "pass"],
      ["control-operation", "pass"],
      ["attestation", "skip"], // unsigned in this scenario (V4)
    ]);
    expect(report.verdict).toBe("pass");
    expect(report.exitCode).toBe(0);
    expect(report.trustBoundary).toMatch(/Assumed: the recording server was honest at write time/);
  });

  it("verifies identically from the .tar.gz as from the file map", async () => {
    await seedClean();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const viaTar = verifyPackage(untarGz(tarGz(packageEntries(pkg))));
    expect(viaTar.verdict).toBe("pass");
    expect(viaTar.checks.map((c) => c.status)).toEqual(verifyPackage(pkg.files).checks.map((c) => c.status));
  });

  it("matching anchors pass and the report says the check was against the package copy", async () => {
    await seedClean();
    const anchor = new InMemoryAnchor();
    await anchorAuditHead(pool, anchor);
    const pkg = await buildEvidencePackage(pool, { ...PERIOD, anchor });
    const report = verifyPackage(pkg.files);
    expect(check(report, "anchors").status).toBe("pass");
    expect(check(report, "anchors").detail).toMatch(/against the package's copy/);
  });
});

describe("V3 — every mutant fails with the RIGHT message", () => {
  it("bit-flip without covering tracks → package-integrity fails on the exact file", async () => {
    await seedClean();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    mutate(pkg.files, "events.jsonl", (t) => t.replace("merged", "mergea"));
    const report = verifyPackage(pkg.files);
    expect(check(report, "package-integrity").status).toBe("fail");
    expect(check(report, "package-integrity").findings.join()).toMatch(/sha256 mismatch: events\.jsonl/);
    expect(report.exitCode).toBe(2);
  });

  it("edited row with tracks covered → chain fails with content mismatch AT that row", async () => {
    await seedClean();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    let editedId = "";
    mutate(pkg.files, "events.jsonl", (t) =>
      t.split("\n").map((line) => {
        if (!line || editedId) return line;
        const row = JSON.parse(line);
        editedId = row.id;
        row.plain_english = "history, rewritten to look nicer";
        return JSON.stringify(row);
      }).join("\n")
    );
    refreshManifest(pkg.files);
    const report = verifyPackage(pkg.files);
    expect(check(report, "package-integrity").status).toBe("pass"); // tracks were covered…
    expect(check(report, "chain").status).toBe("fail"); // …the chain still catches it
    expect(check(report, "chain").findings[0]).toContain(`row ${editedId}: content hash mismatch`);
    expect(report.exitCode).toBe(2);
  });

  it("deleted row → chain fails with broken linkage at the successor", async () => {
    await seedClean();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    mutate(pkg.files, "events.jsonl", (t) => {
      const lines = t.trim().split("\n");
      lines.splice(1, 1); // remove the middle row
      return lines.join("\n") + "\n";
    });
    refreshManifest(pkg.files);
    const report = verifyPackage(pkg.files);
    expect(check(report, "chain").status).toBe("fail");
    expect(check(report, "chain").findings[0]).toMatch(/linkage broken — a row was removed/);
  });

  it("reordered rows → chain fails", async () => {
    await seedClean();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    mutate(pkg.files, "events.jsonl", (t) => {
      const lines = t.trim().split("\n");
      [lines[0], lines[1]] = [lines[1]!, lines[0]!];
      return lines.join("\n") + "\n";
    });
    refreshManifest(pkg.files);
    const report = verifyPackage(pkg.files);
    expect(check(report, "chain").status).toBe("fail");
  });

  it("anchor that doesn't match the chain → anchors fail with 'rewritten'", async () => {
    await seedClean();
    const anchor = new InMemoryAnchor();
    await anchorAuditHead(pool, anchor);
    const pkg = await buildEvidencePackage(pool, { ...PERIOD, anchor });
    mutate(pkg.files, "anchors.json", (t) => {
      const a = JSON.parse(t);
      a.records[0].rowHash = "f".repeat(64);
      return JSON.stringify(a, null, 2) + "\n";
    });
    refreshManifest(pkg.files);
    const report = verifyPackage(pkg.files);
    expect(check(report, "anchors").status).toBe("fail");
    expect(check(report, "anchors").findings[0]).toMatch(/history at or before this point was rewritten/);
  });

  it("unsupported format version is refused, not skipped", async () => {
    await seedClean();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    mutate(pkg.files, "manifest.json", (t) => t.replace("codeworthy-evidence/1", "codeworthy-evidence/99"));
    const report = verifyPackage(pkg.files);
    expect(check(report, "package-integrity").status).toBe("fail");
    expect(check(report, "package-integrity").detail).toMatch(/refusing, not skipping/);
  });
});

describe("V3 — findings vs failures (the record telling the truth about itself)", () => {
  it("red-check merge WITHOUT its exception event is a control-operation FAIL", async () => {
    await seed("acme/app", "change.merged",
      { number: 9, mergeSha: "beef99", approvers: [{ login: "raj" }], selfApproved: false,
        redChecksAtMerge: ["ci"], evidenceGaps: [] },
      "PR #9 merged; 1 of 1 checks FAILING at merge (ci).");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const report = verifyPackage(pkg.files);
    expect(check(report, "control-operation").status).toBe("fail");
    expect(check(report, "control-operation").findings.join()).toMatch(/exception register is incomplete/);
    expect(report.exitCode).toBe(2);
  });

  it("self-approval and declared discrepancies are FINDINGS: verified-with-findings, exit 3", async () => {
    await seed("acme/app", "change.merged",
      { number: 2, mergeSha: "dead22", approvers: [{ login: "dana" }], selfApproved: true,
        redChecksAtMerge: [], evidenceGaps: [] },
      "PR #2 merged with 1 approval (dana) — including the author's own.");
    await seed("acme/app", "reconciliation.completed",
      { repo: "acme/app", expectedMergedPrs: 2, accountedMergedPrs: 1,
        discrepancies: [{ kind: "missing_from_log", number: 3 }], uncoveredIntervals: [], truthTruncated: false },
      "Reconciliation for acme/app: GitHub reports 2 merged pull request(s) in the covered window; the log accounts for 1; 1 discrepancy found.");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const report = verifyPackage(pkg.files);
    expect(report.verdict).toBe("verified-with-findings");
    expect(report.exitCode).toBe(3);
    expect(check(report, "control-operation").status).toBe("pass"); // honest exceptions are not tampering
    expect(check(report, "control-operation").findings.join()).toMatch(/self-approved/);
    expect(check(report, "completeness").findings.join()).toMatch(/declares 1 reconciliation discrepancy/);
  });

  it("a repo with no completeness attestation is surfaced as unattested", async () => {
    await seed("acme/app", "change.merged",
      { number: 5, mergeSha: "aa55", approvers: [{ login: "raj" }], selfApproved: false, redChecksAtMerge: [], evidenceGaps: [] },
      "PR #5 merged with 1 approval (raj).");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const report = verifyPackage(pkg.files);
    expect(check(report, "completeness").findings.join()).toMatch(/population is unattested/);
    expect(report.exitCode).toBe(3);
  });

  it("an llm event without provenance labels is a FAIL — generated content must be attributable", async () => {
    await seedClean();
    await seed("acme/app", "llm.reviewed", { number: 8, findingCount: 2 }, "AI review left 2 notes.");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const report = verifyPackage(pkg.files);
    expect(check(report, "control-operation").status).toBe("fail");
    expect(check(report, "control-operation").findings.join()).toMatch(/lacks provenance labels/);
  });
});
