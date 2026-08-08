#!/usr/bin/env node
// codeworthy-verify — CLI.
//
//   codeworthy-verify report <package-dir | package.tar.gz> [--json] [--oscal]
//                            [--pubkey <public-key.pem>]
//
// --pubkey verifies the package's DSSE attestation under the exporter's
//   PUBLISHED Ed25519 key. Obtain the key independently — a key from inside a
//   package proves nothing.
// --oscal  emits NIST OSCAL assessment-results JSON instead of the human
//   report (same recomputed content, machine-readable for GRC tooling).
//
// Exit codes: 0 = verified clean; 2 = verification FAILED (evidence
// inconsistent with itself); 3 = verified, with findings an auditor must look
// at. Anything printed was recomputed — never an exporter's conclusion.
import { readFileSync } from "node:fs";
import { loadPackage, verifyPackage } from "./verify.mjs";
import { toOscalAssessmentResults } from "./oscal.mjs";
import { buildPopulation, buildSample, populationCsv } from "./workpaper.mjs";

const ICON = { pass: "✓", fail: "✗", skip: "–" };

const USAGE = [
  "usage:",
  "  codeworthy-verify report     <package> [--json] [--oscal] [--pubkey key.pem]",
  "  codeworthy-verify population <package> [--json] [--pubkey key.pem]   (CSV by default)",
  "  codeworthy-verify sample     <package> (--merge <sha> | --pr <number>) [--pubkey key.pem]",
  "<package> is a package directory or .tar.gz",
].join("\n");

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!["report", "population", "sample"].includes(cmd) || !args[1] || args[1].startsWith("--")) {
    console.error(USAGE);
    process.exit(1);
  }
  const path = args[1];
  const asJson = args.includes("--json");
  const asOscal = args.includes("--oscal");
  const pubkeyIdx = args.indexOf("--pubkey");
  let publicKeyPem = null;
  if (pubkeyIdx !== -1) {
    const keyPath = args[pubkeyIdx + 1];
    if (!keyPath) { console.error("--pubkey requires a path to a PEM public key"); process.exit(1); }
    try { publicKeyPem = readFileSync(keyPath, "utf8"); } catch (err) {
      console.error(`cannot read public key: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  let files;
  try {
    files = loadPackage(path);
  } catch (err) {
    console.error(`cannot open package: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (cmd === "population") {
    const res = buildPopulation(files, { publicKeyPem });
    if (!res.ok) { console.error(res.error); process.exit(2); }
    if (args.includes("--json")) console.log(JSON.stringify({ population: res.population, verdict: res.report.verdict }, null, 2));
    else process.stdout.write(populationCsv(res.population));
    process.exit(res.report.exitCode);
  }

  if (cmd === "sample") {
    const mergeIdx = args.indexOf("--merge");
    const prIdx = args.indexOf("--pr");
    const mergeSha = mergeIdx !== -1 ? args[mergeIdx + 1] : undefined;
    const prNumber = prIdx !== -1 ? parseInt(args[prIdx + 1] ?? "", 10) : undefined;
    if (!mergeSha && !Number.isFinite(prNumber)) { console.error(USAGE); process.exit(1); }
    const res = buildSample(files, { mergeSha, prNumber, publicKeyPem });
    if (!res.ok) { console.error(res.error); process.exit(2); }
    process.stdout.write(res.text);
    process.exit(res.report.exitCode);
  }

  const report = verifyPackage(files, { publicKeyPem });

  if (asOscal) {
    let manifestInfo = {};
    try { manifestInfo = JSON.parse(files.get("manifest.json").toString("utf8")); } catch { /* report already covers it */ }
    console.log(JSON.stringify(toOscalAssessmentResults(report, manifestInfo), null, 2));
    process.exit(report.exitCode);
  }
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.exitCode);
  }

  console.log("codeworthy-verify — evidence package report");
  console.log("===========================================\n");
  for (const c of report.checks) {
    console.log(`${ICON[c.status] ?? "?"} ${c.name}: ${c.detail}`);
    for (const f of c.findings.slice(0, 25)) console.log(`    • ${f}`);
    if (c.findings.length > 25) console.log(`    … and ${c.findings.length - 25} more (use --json for all)`);
  }
  console.log(`\nVERDICT: ${report.verdict.toUpperCase()}`);
  console.log(`\nTrust boundary\n  ${report.trustBoundary.replaceAll(". ", ".\n  ")}`);
  process.exit(report.exitCode);
}

main();
