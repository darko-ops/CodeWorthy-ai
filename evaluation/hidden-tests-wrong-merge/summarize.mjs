#!/usr/bin/env node
// Converts a vitest JSON results file from the wrong-merge hidden suite into
// the candidate-safe structured summary (docs/mvp-architecture.md, Principle 5).
//
// The summary carries check ids, plain-language labels, and pass/fail — never
// test source, assertion text, stack traces, file paths, or error messages.
// This is the ONLY hidden-suite output that may ever reach a candidate-facing
// surface. evaluation/hidden-tests-wrong-merge/leak-guard.mjs is the standing
// proof that error paths cannot leak; run it after ANY edit to this file.
import { readFileSync } from "node:fs";

// Check ids are the product vocabulary — they appear verbatim in candidate
// and employer surfaces, so treat them as a stable public contract.
const CHECKS = [
  {
    id: "authz_check_present",
    label: "The cross-customer order listing requires the ops key",
    match: /ops key on the cross-customer/,
  },
  {
    id: "structured_logging_present",
    label: "Checkout emits the order.checkout monitor line with all fields",
    match: /order\.checkout log line/,
  },
  {
    id: "feature_flag_guard_present",
    label: "Backorders are gated behind FLAG_BACKORDERS",
    match: /gates backorders/,
  },
  {
    id: "order_export_intact",
    label: "The finance CSV export still works",
    match: /finance CSV export/,
  },
  {
    id: "unrelated_regression",
    label: "Unrelated checkout behavior is not regressed (totals, stock, validation, replay)",
    match: /computes totals|enforces stock limits|sequential idempotent/,
  },
];

const file = process.argv[2];
if (!file) {
  console.error("usage: summarize.mjs <vitest-results.json>");
  process.exit(2);
}

let results = { testResults: [] };
try {
  results = JSON.parse(readFileSync(file, "utf8"));
} catch {
  // Unreadable results stay "not-run" — never surface the underlying error.
}

const statuses = new Map(); // check id -> "pass" | "fail"

for (const suite of results.testResults ?? []) {
  for (const t of suite.assertionResults ?? []) {
    const title = t.fullName ?? t.title ?? "";
    const check = CHECKS.find((c) => c.match.test(title));
    if (!check) continue;
    // A check stays failed if any matching test failed (throws and timeouts
    // arrive here as status "failed" too).
    const prev = statuses.get(check.id);
    statuses.set(
      check.id,
      t.status === "passed" && prev !== "fail" ? "pass" : t.status === "passed" ? prev : "fail"
    );
  }
}

const checks = CHECKS.map((c) => ({
  id: c.id,
  label: c.label,
  result: statuses.get(c.id) ?? "not-run",
}));

const summary = {
  checks,
  passed: checks.filter((c) => c.result === "pass").length,
  failed: checks.filter((c) => c.result === "fail").length,
  notRun: checks.filter((c) => c.result === "not-run").length,
};

console.log(JSON.stringify(summary, null, 2));
