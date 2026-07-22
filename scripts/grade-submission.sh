#!/usr/bin/env bash
# Grade the AUTOMATED half of one candidate submission.
#
# Runs the two mechanical verifications and consolidates them into one
# grading-record.json a reviewer then uses to fill the report template:
#   1. red/green baseline check  (evaluation/baseline-check/baseline-check.mjs)
#   2. sanitized hidden-suite summary  (the scenario's hidden run.sh --summary)
#
# It deliberately does NOT score the human-judgment competencies (root-cause
# quality, communication, ownership, defense) — those stay with the reviewer.
#
# Usage:
#   scripts/grade-submission.sh --repo <candidate-clone> \
#       --scenario acme-orders|wrong-merge --branch <candidate-branch> \
#       [--db-server postgres://user@host:port] [--baseline <ref>] \
#       [--out grading-record.json]
#
#   --db-server  Postgres server root WITHOUT a database name (default:
#                $CW_DB_SERVER). baseline-check creates its own disposable DBs
#                here; the hidden suite gets a scratch DB on the same server.
#   --baseline   Override the baseline ref (defaults per scenario below).
#
# Requires `psql` on PATH (this script and baseline-check both shell out to
# it). On macOS the server usually runs in Docker without client tools:
#   brew install libpq   # keg-only — then add it to PATH:
#   export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
#
# Untrusted input: the candidate repo is treated as untrusted. This script
# checks out their branch and runs `npm ci` + the existing sandboxed test
# invocations only — nothing else is sourced or executed. Run it on a
# disposable machine; real isolation is roadmap Phase 1.1.
set -euo pipefail

die() { echo "grade: error: $*" >&2; exit 1; }

repo="" scenario="" branch="" baseline="" out="grading-record.json"
db_server="${CW_DB_SERVER:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)      repo="${2:?}"; shift 2 ;;
    --scenario)  scenario="${2:?}"; shift 2 ;;
    --branch)    branch="${2:?}"; shift 2 ;;
    --db-server) db_server="${2:?}"; shift 2 ;;
    --baseline)  baseline="${2:?}"; shift 2 ;;
    --out)       out="${2:?}"; shift 2 ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *)           die "unknown argument: $1" ;;
  esac
done
[ -n "$repo" ] && [ -n "$scenario" ] && [ -n "$branch" ] || die "--repo, --scenario, and --branch are required (see --help)"
[ -n "$db_server" ] || die "--db-server (or \$CW_DB_SERVER) is required, e.g. postgres://acme@localhost:5432"
[ -d "$repo/.git" ] || die "--repo '$repo' is not a git repository"
repo="$(cd "$repo" && pwd)"

platform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$scenario" in
  acme-orders)
    hidden_runner="$platform_root/evaluation/hidden-tests/run.sh"
    [ -n "$baseline" ] || baseline="main"
    ;;
  wrong-merge)
    hidden_runner="$platform_root/evaluation/hidden-tests-wrong-merge/run.sh"
    # Baseline is the locked merge commit M — single source of truth is stamp.sh.
    [ -n "$baseline" ] || baseline="$(grep -oE 'merge_head="[0-9a-f]+"' "$platform_root/simulations/wrong-merge/stamp.sh" | cut -d'"' -f2)"
    ;;
  *) die "unknown scenario '$scenario' (expected acme-orders or wrong-merge)" ;;
esac

git -C "$repo" rev-parse --verify --quiet "$branch^{commit}" >/dev/null || die "branch '$branch' not found in $repo"
git -C "$repo" rev-parse --verify --quiet "$baseline^{commit}" >/dev/null || die "baseline ref '$baseline' not found in $repo"

echo "grading $scenario submission: repo=$repo branch=$branch baseline=$baseline" >&2

# ── Prep: check out the submitted branch, ensure deps ─────────────────────────
git -C "$repo" checkout --quiet "$branch"
if [ ! -d "$repo/node_modules" ]; then
  echo "installing candidate dependencies (npm ci)…" >&2
  (cd "$repo" && npm ci --no-audit --no-fund >/dev/null 2>&1) || die "npm ci failed in candidate repo"
fi

workdir="$(mktemp -d "${TMPDIR:-/tmp}/cw-grade-XXXXXX")"
trap 'rm -rf "$workdir"' EXIT

# ── 1. Red/green baseline check ───────────────────────────────────────────────
echo "running baseline check…" >&2
baseline_record="$workdir/baseline-record.json"
node "$platform_root/evaluation/baseline-check/baseline-check.mjs" \
  --repo "$repo" --baseline "$baseline" --branch "$branch" \
  --db-server "$db_server" --out "$baseline_record" >/dev/null 2>"$workdir/baseline.err" || true
[ -s "$baseline_record" ] || die "baseline check produced no record:
$(cat "$workdir/baseline.err")"

# ── 2. Sanitized hidden-suite summary against the candidate's branch ──────────
echo "running hidden suite…" >&2
scratch_db="cw_grade_$$_$(date +%s)"
psql "$db_server/postgres" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $scratch_db" >/dev/null
cleanup_db() { psql "$db_server/postgres" -qc "DROP DATABASE IF EXISTS $scratch_db WITH (FORCE)" >/dev/null 2>&1 || true; }
trap 'cleanup_db; rm -rf "$workdir"' EXIT

hidden_summary="$workdir/hidden-summary.json"
DATABASE_URL="$db_server/$scratch_db" bash "$hidden_runner" "$repo" --summary >"$hidden_summary" 2>"$workdir/hidden.err" || true
python3 -c "import json,sys; json.load(open('$hidden_summary'))" 2>/dev/null \
  || die "hidden suite produced no valid summary:
$(cat "$workdir/hidden.err")"

# ── 3. Consolidate (facts only — no human-judgment scoring) ───────────────────
generated_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$baseline_record" "$hidden_summary" "$scenario" "$branch" "$baseline" "$generated_at" >"$out" <<'PY'
import json, sys
baseline_record, hidden_summary, scenario, branch, baseline, generated_at = sys.argv[1:7]
bc = json.load(open(baseline_record))
hs = json.load(open(hidden_summary))

verdict = bc.get("verdict")
checks = hs.get("checks", [])
all_hidden_pass = bool(checks) and all(c.get("result") == "pass" for c in checks)

record = {
    "scenario": scenario,
    "branch": branch,
    "baselineRef": baseline,
    "generatedAt": generated_at,
    "baselineCheck": {
        # baseline/branch are null when the candidate changed no test files
        # (verdict "no-test-changes") — guard the .get chain accordingly.
        "verdict": verdict,
        "failsOnBaseline": (bc.get("baseline") or {}).get("failed"),
        "passesOnBranch": (bc.get("branch") or {}).get("passed"),
        "record": bc,
    },
    "hiddenSuite": hs,
    "automatedSummary": {
        "regressionTestGenuine": verdict == "genuine-regression-test",
        "allHiddenChecksPass": all_hidden_pass,
        "hiddenPassed": hs.get("passed"),
        "hiddenFailed": hs.get("failed"),
        # A convenience flag for triage ONLY. It gates nothing on its own and
        # makes NO hire recommendation — the human-judgment competencies
        # (root-cause, communication, ownership, defense) are unscored here.
        "automatedChecksAllGreen": verdict == "genuine-regression-test" and all_hidden_pass,
    },
    "note": "Automated half only. Human-judgment competencies are scored by a reviewer via evaluation/report-template*.md — this record does not make a hiring recommendation.",
}
print(json.dumps(record, indent=2))
PY

cat "$out"
echo "grading record written to $out" >&2
