#!/usr/bin/env bash
# Runs the hidden evaluation suite against the simulation (or a candidate's
# branch checked out into simulations/acme-orders).
#
# Usage: evaluation/hidden-tests/run.sh
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
npx vitest run test/hidden
