// V5 — the auditor workflow surface: the sampling frame and the walkthrough.
// Both are gated on verification: a package that fails must yield NO frame and
// NO walkthrough, only the refusal.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "../audit/audit.js";
import { anchorAuditHead, InMemoryAnchor } from "../audit/tamper.js";
import { buildEvidencePackage } from "./package.js";
import { buildPopulation, buildSample, populationCsv } from "../../../verifier/src/workpaper.mjs";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const PERIOD = { from: new Date(NOW - 7 * DAY).toISOString(), to: new Date(NOW + DAY).toISOString() };

async function seed(repo: string, eventType: string, payload: unknown, plain: string, actor = "dana") {
  return appendAuditEvent(pool, { installationId: 7, repo, eventType, actor, payload, plainEnglish: plain });
}

// A lifecycle: opened → advisory AI note → merged (rich) → exception, plus an
// old webhook-only merge and a reconciliation attestation.
async function seedScenario() {
  await seed("acme/app", "pull_request.opened", { number: 14, title: "Refund flow" }, "dana opened PR #14 in acme/app.");
  await seed("acme/app", "llm.reviewed",
    { number: 14, findingCount: 1, provenance: { policyVersion: "abc123def456", model: "claude-opus-5", promptSha256: "0".repeat(64) } },
    "AI review of PR #14 left 1 advisory note — advice only, nothing was blocked.");
  await seed("acme/app", "pull_request.merged",
    { number: 14, mergeSha: "cafe1234deadbeef", headSha: "feed5678", base: "main", author: "dana", mergedBy: "raj", mergedAt: PERIOD.from },
    "PR #14 in acme/app was merged by raj.", "raj");
  await seed("acme/app", "change.merged",
    { number: 14, mergeSha: "cafe1234deadbeef", headSha: "feed5678", base: "main", author: "dana", mergedAt: PERIOD.from,
      approvers: [{ login: "raj", submittedAt: PERIOD.from }], selfApproved: false, approvalPrecededMerge: true,
      checksAtMerge: [{ name: "ci", conclusion: "success" }], redChecksAtMerge: [], evidenceGaps: [] },
    "PR #14 in acme/app was merged into main by raj with 1 approval (raj); all 1 checks passing at merge.", "raj");
  await seed("acme/app", "exception.force_push", { branch: "main", head: "cafe1234deadbeef" }, "Exception: raj force-pushed main in acme/app.", "raj");
  // an old merge with webhook-only instrumentation
  await seed("acme/app", "pull_request.merged", { number: 2 }, "PR #2 in acme/app was merged by dana.");
  await seed("acme/app", "reconciliation.completed",
    { repo: "acme/app", expectedMergedPrs: 2, accountedMergedPrs: 2, discrepancies: [], uncoveredIntervals: [], truthTruncated: false },
    "Reconciliation for acme/app: GitHub reports 2 merged pull request(s) in the covered window; the log accounts for 2; 0 unexplained discrepancies.");
}

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await migrate(url);
  await pool.query("TRUNCATE audit_events");
  await pool.query("TRUNCATE coverage_windows");
});

describe("V5 — the population (sampling frame)", () => {
  it("one row per merge, rich rows preferred, webhook-only merges labeled", async () => {
    await seedScenario();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const res = buildPopulation(pkg.files);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.population).toHaveLength(2);
    const pr14 = res.population.find((r) => r.pr_number === 14)!;
    expect(pr14.instrumented).toBe("full"); // change.merged won over the webhook row
    expect(pr14.merge_sha).toBe("cafe1234deadbeef");
    expect(pr14.approvers).toBe("raj");
    expect(pr14.self_approved).toBe("no");
    const pr2 = res.population.find((r) => r.pr_number === 2)!;
    expect(pr2.instrumented).toBe("webhook-only");

    const csv = populationCsv(res.population);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("seq,repo,pr_number,merge_sha,merged_at,author,merged_by,approvers,self_approved,red_checks_at_merge,evidence_gaps,instrumented");
    expect(lines).toHaveLength(3);
    expect(csv).toMatch(/cafe1234deadbeef/);
  });

  it("escapes CSV fields containing commas and quotes", async () => {
    await seed("acme/app", "change.merged",
      { number: 3, mergeSha: "s3", author: 'weird"login', approvers: [], selfApproved: false, redChecksAtMerge: [], evidenceGaps: ["reviews_unavailable", "checks_unavailable"] },
      "PR #3 merged.");
    await seed("acme/app", "reconciliation.completed",
      { repo: "acme/app", expectedMergedPrs: 1, accountedMergedPrs: 1, discrepancies: [] },
      "Reconciliation for acme/app: GitHub reports 1 merged pull request(s); the log accounts for 1; 0 unexplained discrepancies.");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const res = buildPopulation(pkg.files);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const csv = populationCsv(res.population);
    expect(csv).toContain('"weird""login"');
    expect(csv).toContain("reviews_unavailable;checks_unavailable");
  });

  it("REFUSES to emit a frame from a package that fails verification", async () => {
    await seedScenario();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    // tamper: edit a row and cover tracks in the manifest? No — just flip a byte.
    const t = pkg.files.get("events.jsonl")!.toString("utf8").replace("raj", "rax");
    pkg.files.set("events.jsonl", Buffer.from(t, "utf8"));
    const res = buildPopulation(pkg.files);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/refusing to emit a sampling frame from unverified evidence/);
  });
});

describe("V5 — the walkthrough (sample)", () => {
  it("traces one change end to end: approvals, checks, lifecycle, exception, advisory labeling, anchor sealing", async () => {
    await seedScenario();
    const anchor = new InMemoryAnchor();
    await anchorAuditHead(pool, anchor); // head after the whole scenario — seals the merge row
    const pkg = await buildEvidencePackage(pool, { ...PERIOD, anchor });

    const res = buildSample(pkg.files, { mergeSha: "cafe1234" }); // prefix works
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const text = res.text;
    expect(text).toContain("WALKTHROUGH — acme/app PR #14");
    expect(text).toMatch(/merge sha\s+cafe1234deadbeef/);
    expect(text).toMatch(/raj approved at/);
    expect(text).toMatch(/success\s+ci/);
    expect(text).toContain("pull_request.opened");
    expect(text).toContain("exception.force_push  [EXCEPTION]");
    expect(text).toContain("llm.reviewed  [ADVISORY — no evidentiary weight]");
    expect(text).toMatch(/sealed by write-once anchor at seq \d+/);
    expect(text).toMatch(/asserts nothing the chained events above do not/);
  });

  it("finds a change by PR number, flags self-approval, and reports missing anchors honestly", async () => {
    await seed("acme/app", "change.merged",
      { number: 7, mergeSha: "beef7777", author: "dana", approvers: [{ login: "dana", submittedAt: PERIOD.from }], selfApproved: true, checksAtMerge: [], redChecksAtMerge: [], evidenceGaps: [] },
      "PR #7 merged with 1 approval (dana) — including the author's own.");
    await seed("acme/app", "reconciliation.completed",
      { repo: "acme/app", expectedMergedPrs: 1, accountedMergedPrs: 1, discrepancies: [] },
      "Reconciliation for acme/app: GitHub reports 1 merged pull request(s); the log accounts for 1; 0 unexplained discrepancies.");
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const res = buildSample(pkg.files, { prNumber: 7 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.text).toContain("<< SELF-APPROVAL");
    expect(res.text).toMatch(/not anchored within this package's records/);
  });

  it("an unknown merge is a clear error; a tampered package refuses the walkthrough", async () => {
    await seedScenario();
    const pkg = await buildEvidencePackage(pool, { ...PERIOD });
    const miss = buildSample(pkg.files, { mergeSha: "0000000" });
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.error).toMatch(/no merge matching merge SHA 0000000/);

    const t = pkg.files.get("events.jsonl")!.toString("utf8").replace("merged into main", "merged into prod");
    pkg.files.set("events.jsonl", Buffer.from(t, "utf8"));
    const bad = buildSample(pkg.files, { mergeSha: "cafe1234" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/walkthrough of unverified evidence proves nothing/);
  });
});
