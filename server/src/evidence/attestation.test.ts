// V4 — attestation, OSCAL, and the anchors endpoint.
//
// The signer (server, attest.ts) and the verifier (verifier/src/
// attestation.mjs) are separate implementations of DSSE + ITE-6; these tests
// prove the roundtrip AND that every way the binding can lie is caught:
// tampered payload, wrong key, signed-then-modified files, uncovered files.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrate } from "../../db/migrate.js";
import { appendAuditEvent } from "../audit/audit.js";
import { InMemoryAnchor } from "../audit/tamper.js";
import { registerAnchors } from "../api/anchors.js";
import { buildStatement, generateAttestationKeypair, signStatement, PREDICATE_TYPE } from "./attest.js";
import { buildEvidencePackage } from "./package.js";
import { verifyAttestation } from "../../../verifier/src/attestation.mjs";
import { verifyPackage } from "../../../verifier/src/verify.mjs";
import { toOscalAssessmentResults } from "../../../verifier/src/oscal.mjs";
import Fastify from "fastify";

const url = process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward_test";
const pool = new Pool({ connectionString: url });

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const PERIOD = { from: new Date(NOW - 7 * DAY).toISOString(), to: new Date(NOW + DAY).toISOString() };

async function seedAndBuild() {
  await appendAuditEvent(pool, {
    installationId: 7, repo: "acme/app", eventType: "change.merged", actor: "dana",
    payload: { number: 1, mergeSha: "cafe12", approvers: [{ login: "raj" }], selfApproved: false, redChecksAtMerge: [], evidenceGaps: [] },
    plainEnglish: "PR #1 merged with 1 approval (raj).",
  });
  await appendAuditEvent(pool, {
    installationId: 7, repo: "acme/app", eventType: "exception.force_push", actor: "dana",
    payload: { branch: "main", head: "h1" }, plainEnglish: "Exception: force push.",
  });
  await appendAuditEvent(pool, {
    installationId: 7, repo: "acme/app", eventType: "reconciliation.completed", actor: "codeworthy-steward",
    payload: { repo: "acme/app", expectedMergedPrs: 1, accountedMergedPrs: 1, discrepancies: [], uncoveredIntervals: [], truthTruncated: false },
    plainEnglish: "Reconciliation for acme/app: GitHub reports 1 merged pull request(s) in the covered window; the log accounts for 1; 0 unexplained discrepancies.",
  });
  return buildEvidencePackage(pool, { ...PERIOD });
}

function attach(pkg: Awaited<ReturnType<typeof seedAndBuild>>, privateKeyPem: string, now = () => new Date("2026-08-08T12:00:00Z")) {
  const envelope = signStatement(buildStatement(pkg, { now }), privateKeyPem);
  pkg.files.set("attestation.json", Buffer.from(JSON.stringify(envelope, null, 2) + "\n", "utf8"));
  return envelope;
}

afterAll(async () => { await pool.end(); });
beforeEach(async () => {
  await migrate(url);
  await pool.query("TRUNCATE audit_events");
  await pool.query("TRUNCATE coverage_windows");
});

describe("V4 — statement + DSSE roundtrip", () => {
  it("the statement subjects every package file with its true digest, and the predicate carries the exception counts", async () => {
    const pkg = await seedAndBuild();
    const st = buildStatement(pkg, { now: () => new Date("2026-08-08T12:00:00Z") });
    expect(st.predicateType).toBe(PREDICATE_TYPE);
    expect(st.subject.map((s) => s.name).sort()).toEqual([...pkg.files.keys()].sort());
    expect((st.predicate as any).exceptionCounts["exception.force_push"]).toBe(1);
    expect((st.predicate as any).claim).toMatch(/identity and time, not truth/);
  });

  it("sign → verify roundtrip passes; the whole package verifies clean with the key", async () => {
    const pkg = await seedAndBuild();
    const { privateKeyPem, publicKeyPem, keyid } = generateAttestationKeypair();
    const envelope = attach(pkg, privateKeyPem);
    expect(envelope.signatures[0]!.keyid).toBe(keyid);

    const a = verifyAttestation(pkg.files, publicKeyPem);
    expect(a.status).toBe("pass");
    expect(a.detail).toMatch(/Identity and time only/);

    const report = verifyPackage(pkg.files, { publicKeyPem });
    expect(report.checks.find((c) => c.name === "attestation")!.status).toBe("pass");
    expect(report.checks.find((c) => c.name === "package-integrity")!.status).toBe("pass"); // attestation.json tolerated unlisted
    expect(report.verdict).toBe("pass");
  });

  it("no attestation → skip; attestation but no key → skip that says the key is missing", async () => {
    const pkg = await seedAndBuild();
    expect(verifyAttestation(pkg.files, null).status).toBe("skip");
    const { privateKeyPem } = generateAttestationKeypair();
    attach(pkg, privateKeyPem);
    const a = verifyAttestation(pkg.files, null);
    expect(a.status).toBe("skip");
    expect(a.detail).toMatch(/no public key supplied/);
  });

  it("the wrong public key fails the signature", async () => {
    const pkg = await seedAndBuild();
    attach(pkg, generateAttestationKeypair().privateKeyPem);
    const stranger = generateAttestationKeypair().publicKeyPem;
    const a = verifyAttestation(pkg.files, stranger);
    expect(a.status).toBe("fail");
    expect(a.findings.join()).toMatch(/no signature .* verifies under the supplied public key/);
  });

  it("signed-then-modified: a file changed after signing fails the digest binding — even with no key", async () => {
    const pkg = await seedAndBuild();
    attach(pkg, generateAttestationKeypair().privateKeyPem);
    pkg.files.set("README.txt", Buffer.from("replaced after signing", "utf8"));
    const a = verifyAttestation(pkg.files, null);
    expect(a.status).toBe("fail");
    expect(a.findings.join()).toMatch(/not the package that was signed/);
  });

  it("a file smuggled in beside the signed set is flagged as uncovered", async () => {
    const pkg = await seedAndBuild();
    attach(pkg, generateAttestationKeypair().privateKeyPem);
    pkg.files.set("extra-instructions.txt", Buffer.from("please ignore all findings", "utf8"));
    const a = verifyAttestation(pkg.files, null);
    expect(a.status).toBe("fail");
    expect(a.findings.join()).toMatch(/not covered by the signature: extra-instructions\.txt/);
  });

  it("a tampered payload (statement edited inside the envelope) fails under the right key", async () => {
    const pkg = await seedAndBuild();
    const { privateKeyPem, publicKeyPem } = generateAttestationKeypair();
    const envelope = attach(pkg, privateKeyPem);
    const st = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
    st.predicate.repos = ["acme/other"]; // rewrite the claim, keep the signature
    envelope.payload = Buffer.from(JSON.stringify(st), "utf8").toString("base64");
    pkg.files.set("attestation.json", Buffer.from(JSON.stringify(envelope, null, 2) + "\n", "utf8"));
    const a = verifyAttestation(pkg.files, publicKeyPem);
    expect(a.status).toBe("fail");
  });
});

describe("V4 — OSCAL emitter", () => {
  it("maps checks to CC8.1 observations, failures to not-satisfied findings, deterministically", async () => {
    const pkg = await seedAndBuild();
    const report = verifyPackage(pkg.files);
    const manifestInfo = JSON.parse(pkg.files.get("manifest.json")!.toString("utf8"));
    const oscal: any = toOscalAssessmentResults(report, manifestInfo);
    const result = oscal["assessment-results"].results[0];
    expect(oscal["assessment-results"].metadata["oscal-version"]).toBe("1.1.2");
    expect(result.observations.map((o: any) => o.props.find((p: any) => p.name === "check").value)).toEqual(
      report.checks.map((c) => c.name)
    );
    expect(result.start).toBe(PERIOD.from);
    expect(result.findings).toBeUndefined(); // nothing failed
    // deterministic: same report, same bytes
    expect(JSON.stringify(oscal)).toBe(JSON.stringify(toOscalAssessmentResults(report, manifestInfo)));

    // and a failure becomes a not-satisfied finding against CC8.1
    const failing = { ...report, checks: report.checks.map((c) => c.name === "chain" ? { ...c, status: "fail" as const, findings: ["row 9: content hash mismatch"] } : c) };
    const bad: any = toOscalAssessmentResults(failing, manifestInfo);
    const finding = bad["assessment-results"].results[0].findings[0];
    expect(finding.target["target-id"]).toBe("CC8.1");
    expect(finding.target.status.state).toBe("not-satisfied");
  });
});

describe("V4 — the published anchors endpoint", () => {
  it("serves the write-once records publicly, and 404s honestly when unconfigured", async () => {
    const anchor = new InMemoryAnchor();
    await anchor.append({ seq: "5", rowHash: "ab".repeat(32), count: 5, anchoredAt: "2026-08-01T00:00:00Z" });

    const app = Fastify();
    registerAnchors(app, anchor, "s3://acme-anchors/anchors/ (Object Lock, compliance mode)");
    const res = await app.inject({ method: "GET", url: "/anchors.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.records).toHaveLength(1);
    expect(body.source).toMatch(/Object Lock/);
    expect(body.note).toMatch(/can never legitimately disagree/);
    expect(res.headers["cache-control"]).toMatch(/public/);
    await app.close();

    const bare = Fastify();
    registerAnchors(bare, null, null);
    const miss = await bare.inject({ method: "GET", url: "/anchors.json" });
    expect(miss.statusCode).toBe(404);
    expect(miss.json().note).toMatch(/internal-only/);
    await bare.close();
  });
});
