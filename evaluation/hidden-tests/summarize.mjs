#!/usr/bin/env node
// Converts a vitest JSON results file from the hidden suite into the
// candidate-safe structured summary (docs/mvp-architecture.md, Principle 5).
//
// The summary carries check ids, plain-language labels, and pass/fail — never
// test source, assertion text, or stack traces. This is the ONLY hidden-suite
// output that may ever reach a candidate-facing surface.
import { readFileSync } from "node:fs";

// Check ids are the product vocabulary — they appear verbatim in candidate
// and employer surfaces (see the mission-control mockups), so treat them as a
// stable public contract. Several internal tests may roll up into one check.
const CHECKS = [
  {
    id: "concurrent_same_key_retry",
    label: "A retry that overlaps the original request creates exactly one order and one charge",
    match: /timed-out checkout is retried/,
  },
  {
    id: "cross_replica_dedup",
    label: "A retry landing on another replica (or after a restart) does not duplicate the order",
    match: /across API replicas/,
  },
  {
    id: "reused_key_distinct_checkout",
    label: "Distinct checkouts with distinct keys still create distinct orders",
    match: /distinct checkouts with distinct keys/,
  },
  {
    id: "no_key_checkout",
    label: "Checkout without an idempotency key still works",
    match: /without any idempotency key/,
  },
  {
    id: "unrelated_regression",
    label: "Unrelated checkout behavior is not regressed (totals, stock limits, validation)",
    match: /computes totals|enforces stock limits|validates unknown customers/,
  },
];

const file = process.argv[2];
if (!file) {
  console.error("usage: summarize.mjs <vitest-results.json>");
  process.exit(2);
}

const results = JSON.parse(readFileSync(file, "utf8"));
const statuses = new Map(); // check id -> "pass" | "fail"

for (const suite of results.testResults ?? []) {
  for (const t of suite.assertionResults ?? []) {
    const title = t.fullName ?? t.title ?? "";
    const check = CHECKS.find((c) => c.match.test(title));
    if (!check) continue;
    // A check stays failed if any matching test failed.
    const prev = statuses.get(check.id);
    statuses.set(check.id, t.status === "passed" && prev !== "fail" ? "pass" : t.status === "passed" ? prev : "fail");
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
