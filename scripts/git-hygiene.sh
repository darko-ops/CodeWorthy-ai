#!/usr/bin/env bash
# git-hygiene — a read-only "what's the state of my repo(s)?" check.
#
# It NEVER commits, pushes, merges, or changes anything. It only tells you what
# needs attention, so you stay in control (which is the whole point — auto-
# committing/merging is the anti-pattern, not the goal).
#
# Usage:
#   scripts/git-hygiene.sh                 # check the current repo
#   scripts/git-hygiene.sh ~/a ~/b ~/c     # check several repos
#   scripts/git-hygiene.sh --fetch         # refresh remote state first (network)
#
# Exit code is always 0 — it's informational.
set -uo pipefail

do_fetch=0
paths=()
for a in "$@"; do
  case "$a" in
    --fetch) do_fetch=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) paths+=("$a") ;;
  esac
done
[ ${#paths[@]} -eq 0 ] && paths=(".")

green="\033[32m"; yellow="\033[33m"; red="\033[31m"; dim="\033[2m"; bold="\033[1m"; off="\033[0m"
ok(){   printf "  ${green}✓${off} %s\n" "$1"; }
warn(){ printf "  ${yellow}⚠${off} %s\n" "$1"; }
act(){  printf "  ${red}→${off} %s\n" "$1"; }
note(){ printf "  ${dim}%s${off}\n" "$1"; }

check_repo() {
  local dir="$1"
  if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf "${bold}%s${off}\n" "$dir"; warn "not a git repository"; echo; return
  fi
  local root; root="$(git -C "$dir" rev-parse --show-toplevel)"
  printf "${bold}%s${off}\n" "$root"

  [ "$do_fetch" = 1 ] && git -C "$dir" fetch --quiet --all 2>/dev/null

  # Current branch
  local branch; branch="$(git -C "$dir" branch --show-current)"
  if [ -z "$branch" ]; then
    warn "detached HEAD — you're not on a branch. Create one before committing: git switch -c <name>"
  elif [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    warn "on '$branch' (the default branch) — prefer a feature branch: git switch -c <name>"
  else
    ok "on feature branch '$branch'"
  fi

  # Uncommitted work
  local dirty; dirty="$(git -C "$dir" status --porcelain 2>/dev/null)"
  if [ -n "$dirty" ]; then
    local n; n="$(printf "%s\n" "$dirty" | grep -c .)"
    act "$n uncommitted change(s) — review with 'git status', then commit in focused chunks"
  else
    ok "working tree clean"
  fi

  # Upstream / ahead-behind
  if git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    local counts ahead behind
    counts="$(git -C "$dir" rev-list --left-right --count '@{upstream}...HEAD' 2>/dev/null)"
    behind="$(printf "%s" "$counts" | awk '{print $1}')"
    ahead="$(printf "%s" "$counts" | awk '{print $2}')"
    [ "${ahead:-0}" -gt 0 ] && act "$ahead commit(s) not pushed — 'git push'"
    [ "${behind:-0}" -gt 0 ] && act "$behind commit(s) behind upstream — 'git pull --rebase' before you continue"
    [ "${ahead:-0}" -eq 0 ] && [ "${behind:-0}" -eq 0 ] && ok "in sync with upstream"
  elif [ -n "$branch" ]; then
    warn "branch '$branch' has no upstream — first push: git push -u origin $branch"
  fi
  [ "$do_fetch" = 0 ] && note "(remote state may be stale — re-run with --fetch for the latest)"

  # Accidental big/ignored artifacts staged
  if git -C "$dir" diff --cached --name-only 2>/dev/null | grep -qiE '(^|/)(node_modules|dist|\.env|\.env\.|.*\.log)$'; then
    act "you've staged something that looks build-generated or secret (.env / node_modules / dist / *.log) — unstage it and add to .gitignore"
  fi

  # Last commit age (gentle nudge, never a rule)
  local last; last="$(git -C "$dir" log -1 --format='%cr' 2>/dev/null)"
  [ -n "$last" ] && note "last commit: $last"
  echo
}

for p in "${paths[@]}"; do check_repo "$p"; done
