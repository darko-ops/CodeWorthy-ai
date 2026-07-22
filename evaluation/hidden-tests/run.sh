#!/usr/bin/env bash
# Runs the hidden evaluation suite against a candidate repo, or (default) the
# platform's own simulation copy.
#
# Usage:
#   evaluation/hidden-tests/run.sh                     # platform sim, full output
#   evaluation/hidden-tests/run.sh --summary           # platform sim, summary only
#   evaluation/hidden-tests/run.sh <repo>              # candidate repo, full output
#   evaluation/hidden-tests/run.sh <repo> --summary    # candidate repo, summary only
#
# The optional repo path mirrors the wrong-merge runner's contract, so one
# grader can drive both scenarios. Omitting it keeps the original behavior
# (used by CI's seeded-bug guard).
#
# --summary prints ONLY the structured pass/fail summary (via summarize.mjs) —
# no test names, assertions, or stack traces. That is the only mode whose
# output may reach a candidate-facing surface.
#
# Requires: DATABASE_URL pointing at a disposable Postgres (or the
# docker-compose db), and `npm install` already run in the target repo.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Optional leading positional = candidate repo path; anything starting with
# "--" (i.e. --summary) means "use the platform sim".
sim="$repo_root/simulations/acme-orders"
if [ "${1:-}" != "" ] && [ "${1#--}" = "${1:-}" ]; then
  sim="$1"; shift
fi
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
