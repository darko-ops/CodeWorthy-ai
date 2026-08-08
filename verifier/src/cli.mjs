#!/usr/bin/env node
// codeworthy-verify — CLI.
//
//   codeworthy-verify report <package-dir | package.tar.gz> [--json]
//
// Exit codes: 0 = verified clean; 2 = verification FAILED (evidence
// inconsistent with itself); 3 = verified, with findings an auditor must look
// at (declared exceptions, coverage limits, discrepancies). Anything the
// verifier prints, it recomputed — it never repeats an exporter's conclusion.
import { loadPackage, verifyPackage } from "./verify.mjs";

const ICON = { pass: "✓", fail: "✗", skip: "–" };

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd !== "report" || !args[1]) {
    console.error("usage: codeworthy-verify report <package-dir | package.tar.gz> [--json]");
    process.exit(1);
  }
  const path = args[1];
  const asJson = args.includes("--json");

  let files;
  try {
    files = loadPackage(path);
  } catch (err) {
    console.error(`cannot open package: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const report = verifyPackage(files);

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
