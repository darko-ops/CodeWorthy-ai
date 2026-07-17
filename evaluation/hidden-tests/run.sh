#!/usr/bin/env bash
# Runs the hidden evaluation suite against the simulation (or a candidate's
# branch checked out into simulations/acme-orders).
#
# Usage:
#   evaluation/hidden-tests/run.sh             # full vitest output (graders/CI)
#   evaluation/hidden-tests/run.sh --summary   # candidate-safe JSON summary only
#
# --summary prints ONLY the structured pass/fail summary (via summarize.mjs) —
# no test names, assertions, or stack traces. That is the only mode whose
# output may reach a candidate-facing surface.
#
# Requires: DATABASE_URL pointing at a disposable Postgres (or the
# docker-compose db), and `npm install` already run in the simulation.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sim="$repo_root/simulations/acme-orders"
hidden_dir="$sim/test/hidden"

mkdir -p "$hidden_dir"
trap 'rm -rf "$hidden_dir"' EXIT
cp "$repo_root/evaluation/hidden-tests/"*.hidden.test.ts "$hidden_dir/"

cd "$sim"

if [ "${1:-}" = "--summary" ]; then
  results="$(mktemp)"
  trap 'rm -rf "$hidden_dir" "$results"' EXIT
  status=0
  npx vitest run test/hidden --reporter=json --outputFile="$results" >/dev/null 2>&1 || status=$?
  node "$repo_root/evaluation/hidden-tests/summarize.mjs" "$results"
  exit "$status"
fi

npx vitest run test/hidden
