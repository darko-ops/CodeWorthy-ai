#!/usr/bin/env bash
# Stamps a candidate repository for the wrong-merge scenario (ACME-1490).
#
# The candidate's discovery path depends on git archaeology, so stamping MUST
# preserve the full multi-parent history — all six commits plus the merge —
# never a squashed snapshot. The scenario ships as a git bundle for exactly
# that reason; this script clones it and verifies the invariants.
#
# Usage: stamp.sh <destination-directory>
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dest="${1:?usage: stamp.sh <destination-directory>}"
merge_head="9997d60"

git clone --quiet "$here/scenario.bundle" "$dest"
git -C "$dest" remote remove origin   # the candidate repo gets its own origin

# --- invariants ---------------------------------------------------------
fail() { echo "stamp: INVARIANT VIOLATED — $1" >&2; exit 1; }

[ "$(git -C "$dest" rev-parse --short HEAD)" = "$merge_head" ] \
  || fail "HEAD is not the locked merge commit $merge_head"

parents=$(git -C "$dest" rev-list --parents -n 1 HEAD | wc -w)
[ "$parents" -eq 3 ] || fail "merge commit does not have two parents"

commits=$(git -C "$dest" rev-list --count HEAD)
[ "$commits" -eq 7 ] || fail "expected 7 reachable commits, found $commits"

for breadcrumb in src/middleware/opsKey.ts src/lib/flags.ts; do
  [ -f "$dest/$breadcrumb" ] || fail "breadcrumb $breadcrumb missing"
done
grep -q "OPS_API_KEY" "$dest/.env.example" || fail "OPS_API_KEY breadcrumb missing from .env.example"
grep -q "FLAG_BACKORDERS" "$dest/.env.example" || fail "FLAG_BACKORDERS breadcrumb missing from .env.example"
grep -q "createBackorder" "$dest/src/services/orderService.ts" || fail "createBackorder breadcrumb missing"

echo "stamped $dest at $merge_head — full history + breadcrumbs verified"
