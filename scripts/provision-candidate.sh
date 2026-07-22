#!/usr/bin/env bash
# Provision one candidate repository for a CodeWorthy assessment.
#
# Assembles the candidate working tree locally (from committed platform state),
# runs a leak check proving no evaluation material is included, then creates the
# private GitHub repo, pushes, opens the ticket Issue, and invites the
# candidate — all GitHub mutations go through `gh` and honor --dry-run.
#
# Usage:
#   scripts/provision-candidate.sh --scenario acme-orders|wrong-merge \
#       --candidate <github-username> --repo-name <name> \
#       [--org <github-org>] [--dry-run] [--verify] [--keep-workdir]
#
#   --org           GitHub org to create the repo under (default: $CW_GITHUB_ORG,
#                   else CodeWorthy-ai — candidate repos live under the org).
#                   See docs/github-topology.md for the full repo layout.
#   --dry-run       Assemble + leak-check locally, but print GitHub commands
#                   instead of executing them. Works without `gh` installed.
#   --verify        After assembly, run `npm ci && npm test` in the working tree
#                   (requires DATABASE_URL pointing at a disposable Postgres).
#   --keep-workdir  Don't delete the assembled tree on success (it is always
#                   kept on failure, with its path printed).
#
# Requirements: git; `gh` authenticated with repo-creation rights (unless
# --dry-run); node/npm and Postgres only if --verify.
set -euo pipefail

die() { echo "provision: error: $*" >&2; exit 1; }

scenario="" candidate="" repo_name="" org="${CW_GITHUB_ORG:-CodeWorthy-ai}"
dry_run=0 verify=0 keep_workdir=0
while [ $# -gt 0 ]; do
  case "$1" in
    --scenario)     scenario="${2:?}"; shift 2 ;;
    --candidate)    candidate="${2:?}"; shift 2 ;;
    --repo-name)    repo_name="${2:?}"; shift 2 ;;
    --org)          org="${2:?}"; shift 2 ;;
    --dry-run)      dry_run=1; shift ;;
    --verify)       verify=1; shift ;;
    --keep-workdir) keep_workdir=1; shift ;;
    -h|--help)      sed -n '2,22p' "$0"; exit 0 ;;
    *)              die "unknown argument: $1" ;;
  esac
done
[ -n "$scenario" ] && [ -n "$candidate" ] && [ -n "$repo_name" ] \
  || die "--scenario, --candidate, and --repo-name are required (see --help)"

platform_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$scenario" in
  acme-orders)
    timebox="4 hours"
    issue_title="ACME-1287: Duplicate orders when checkout is retried"
    playbook_section="Timeline of proctor actions (ACME-1287)"
    ;;
  wrong-merge)
    timebox="2 hours"
    issue_title="ACME-1490: Regressions after the order-export merge"
    playbook_section="ACME-1490 — The Wrong Merge (scenario-specific notes)"
    ;;
  *) die "unknown scenario '$scenario' (expected acme-orders or wrong-merge)" ;;
esac

full_name="${org:+$org/}$repo_name"
workdir="$(mktemp -d "${TMPDIR:-/tmp}/cw-provision-XXXXXX")"
repo_dir="$workdir/repo"
echo "assembling '$scenario' candidate tree in $repo_dir"

# ── 1. Assemble the candidate working tree from COMMITTED platform state ──────
case "$scenario" in
  acme-orders)
    mkdir -p "$repo_dir"
    # git archive: only tracked files ship — uncommitted edits and stray local
    # files never reach a candidate.
    git -C "$platform_root" archive HEAD:simulations/acme-orders | tar -x -C "$repo_dir"
    git -C "$repo_dir" init -qb main
    ;;
  wrong-merge)
    # stamp.sh clones the scenario bundle and verifies the seeded-history
    # invariants (locked merge HEAD, two parents, breadcrumbs).
    bash "$platform_root/simulations/wrong-merge/stamp.sh" "$repo_dir"
    git -C "$platform_root" show HEAD:simulations/wrong-merge/TICKET.md     > "$repo_dir/TICKET.md"
    git -C "$platform_root" show HEAD:simulations/wrong-merge/ASSESSMENT.md > "$repo_dir/ASSESSMENT.md"
    ;;
esac

mkdir -p "$repo_dir/.github/workflows"
git -C "$platform_root" show HEAD:evaluation/candidate-repo/ci.yml > "$repo_dir/.github/workflows/ci.yml"

if [ "$scenario" = "acme-orders" ]; then
  git -C "$repo_dir" add -A
  git -C "$repo_dir" -c user.name="Acme Engineering" -c user.email="eng@acme.example" \
    commit -q -m "Bootstrap Acme order-management service"
else
  # Overlay commit on top of the seeded history. The graded baseline stays the
  # merge commit M (pinned by SHA in the proctor notes), so one platform commit
  # above it does not disturb the archaeology or the signature.
  merge_head="$(grep -oE 'merge_head="[0-9a-f]+"' "$platform_root/simulations/wrong-merge/stamp.sh" | cut -d'"' -f2)"
  git -C "$repo_dir" add -A
  git -C "$repo_dir" -c user.name="CodeWorthy Assessments" -c user.email="assessments@codeworthy.dev" \
    commit -q -m "Add CodeWorthy assessment brief and CI workflow"
  [ "$(git -C "$repo_dir" rev-parse --short "HEAD~1")" = "$merge_head" ] \
    || die "overlay commit is not directly on top of the locked merge $merge_head"
fi

# ── 2. Leak check: no evaluation material may ship ────────────────────────────
# Path check: no file or directory name may match private-material patterns.
leaks="$(cd "$repo_dir" && find . -path ./.git -prune -o -print \
  | grep -iE 'hidden|rubric|baseline-check|leak-guard|defense-question|report-template|proctor|reference-solution|evaluation' || true)"
[ -z "$leaks" ] || die "leak check FAILED — private paths in candidate tree:
$leaks"
# Content check: markers that exist only in private material. (Deliberately
# narrow — words like "seed"/"hidden" appear legitimately in candidate-facing
# files, so the path check above carries the broad patterns.)
if grep -RIlq --exclude-dir=.git \
     -e "HIDDEN EVALUATION SUITE" -e "evaluation/hidden-tests" -e "genuine-regression-test" \
     "$repo_dir"; then
  die "leak check FAILED — private content markers found: $(grep -RIl --exclude-dir=.git -e 'HIDDEN EVALUATION SUITE' -e 'evaluation/hidden-tests' -e 'genuine-regression-test' "$repo_dir")"
fi
echo "leak check passed: no evaluation material in the candidate tree"

# ── 3. Optional: prove the tree runs green as a candidate would receive it ────
if [ "$verify" = 1 ]; then
  [ -n "${DATABASE_URL:-}" ] || die "--verify needs DATABASE_URL (disposable Postgres)"
  echo "verifying: npm ci && npm test in the candidate tree"
  (cd "$repo_dir" && npm ci --no-audit --no-fund >/dev/null 2>&1 && npm test) \
    || die "verification failed — the assembled tree is not green"
  rm -rf "$repo_dir/node_modules"
  echo "verification passed: candidate tree is green"
fi

# ── 4. GitHub: create, push, ticket, invite ───────────────────────────────────
run() { if [ "$dry_run" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

if [ "$dry_run" = 0 ]; then
  command -v gh >/dev/null || die "gh CLI not found (use --dry-run to preview without it)"
  gh repo view "$full_name" >/dev/null 2>&1 \
    && die "repo $full_name already exists — one fresh repo per candidate per scenario; pick a new --repo-name"
fi

run gh repo create "$full_name" --private --source "$repo_dir" --remote origin --push
run gh issue create --repo "$full_name" --title "$issue_title" --body-file "$repo_dir/TICKET.md"
run gh api -X PUT "repos/$full_name/collaborators/$candidate" -f permission=push

if [ "$keep_workdir" = 1 ] || [ "$dry_run" = 1 ]; then
  echo "assembled tree kept at: $repo_dir"
else
  rm -rf "$workdir"
fi

# ── 5. What the proctor still does by hand ────────────────────────────────────
cat <<EOF

Provisioned: $full_name  (scenario: $scenario, candidate: $candidate)

Still manual — do these yourself:
  [ ] Confirm GitHub Actions is enabled on the repo and the first CI run is green.
  [ ] Send the invite email: link ASSESSMENT.md in the repo, restate the
      $timebox timebox, and say the clock starts when they accept.
  [ ] Start the timebox when the candidate accepts the invitation.
  [ ] Have evaluation/proctor-playbook.md open at: "$playbook_section".
  [ ] After submission: scripts/grade-submission.sh (roadmap 0.3).
EOF
