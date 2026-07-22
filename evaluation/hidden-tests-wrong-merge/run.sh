#!/usr/bin/env bash
# Runs the wrong-merge hidden suite against a candidate repository.
#
# Usage:
#   run.sh <candidate-repo-path>             # full vitest output (graders/CI)
#   run.sh <candidate-repo-path> --summary   # candidate-safe JSON summary only
#
# --summary prints ONLY the structured pass/fail summary (via summarize.mjs) —
# no test names, assertions, or stack traces. That is the only mode whose
# output may reach a candidate-facing surface.
#
# Requires: DATABASE_URL pointing at a disposable Postgres, and `npm install`
# already run in the candidate repo. Hidden specs are copied in for the run
# and removed on exit — they must never persist on a candidate-readable path.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="${1:?usage: run.sh <candidate-repo-path> [--summary]}"
shift || true
hidden_dir="$repo/test/hidden"

mkdir -p "$hidden_dir"
trap 'rm -rf "$hidden_dir"' EXIT
cp "$here"/*.hidden.test.ts "$hidden_dir/"

cd "$repo"

if [ "${1:-}" = "--summary" ]; then
  results="$(mktemp)"
  trap 'rm -rf "$hidden_dir" "$results"' EXIT
  status=0
  npx vitest run test/hidden --reporter=json --outputFile="$results" >/dev/null 2>&1 || status=$?
  node "$here/summarize.mjs" "$results"
  exit "$status"
fi

npx vitest run test/hidden
