#!/usr/bin/env node
// CI guard for the wrong-merge scenario's seeded state: asserts the hidden
// suite's --summary against the locked baseline yields EXACTLY
//   authz_check_present:fail  structured_logging_present:fail
//   feature_flag_guard_present:fail  order_export_intact:pass
//   unrelated_regression:pass
// Any drift — a behavior that stops being deleted, a check that flips — fails
// this script, not merely "suite exits nonzero."
//
// Usage: node assert-baseline-signature.mjs --repo <stamped-candidate-repo>
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const repo = arg("repo");
if (!repo || !process.env.DATABASE_URL) {
  console.error("usage: DATABASE_URL=... node assert-baseline-signature.mjs --repo <repo>");
  process.exit(2);
}

const EXPECTED = {
  authz_check_present: "fail",
  structured_logging_present: "fail",
  feature_flag_guard_present: "fail",
  order_export_intact: "pass",
  unrelated_regression: "pass",
};

const res = spawnSync("bash", [join(here, "run.sh"), repo, "--summary"], {
  encoding: "utf8",
  timeout: 10 * 60 * 1000,
});

let summary;
try {
  summary = JSON.parse(res.stdout);
} catch {
  console.error("could not parse --summary output:");
  console.error(res.stdout);
  process.exit(1);
}

const got = Object.fromEntries(summary.checks.map((c) => [c.id, c.result]));
const problems = [];
for (const [id, want] of Object.entries(EXPECTED)) {
  if (got[id] !== want) problems.push(`${id}: want ${want}, got ${got[id] ?? "(missing)"}`);
}
for (const id of Object.keys(got)) {
  if (!(id in EXPECTED)) problems.push(`unexpected check id in summary: ${id}`);
}

if (problems.length > 0) {
  console.error("seeded-state signature DRIFTED from the calibrated baseline:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  "baseline signature OK: " +
    Object.entries(EXPECTED).map(([id, r]) => `${id}:${r}`).join("  ")
);
