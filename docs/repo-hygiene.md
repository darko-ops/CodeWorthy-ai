# Repo Hygiene — a working guide (for me, while I build)

A short, practical playbook for keeping any repo organized and team-acceptable
*as you work*, so you don't get bitten. This is a personal-workflow aid, not
CodeWorthy product code — but it's the same discipline CodeWorthy measures, so
following it is dogfooding.

The golden rule: **stay in control.** Tools should *remind* you what needs doing;
you decide and do it. Never auto-commit or auto-merge — that's the exact
anti-pattern (accepting changes you didn't review) that causes the problems.

## The daily loop

1. **Before you start:** `git switch main && git pull --rebase` (get the latest),
   then branch: `git switch -c short-descriptive-name`.
2. **While building:** commit in **small, focused chunks** with a clear message —
   one logical change per commit. Push often (`git push -u origin <branch>` the
   first time, `git push` after). Pushing early means you never lose work and
   others can see it.
3. **Before you stop for the day:** run `scripts/git-hygiene.sh` — it tells you
   if you have uncommitted or unpushed work, or if you've drifted behind.
4. **To ship:** open a PR (not a direct push to main). Let CI go green. Merge.
   Delete the branch.

That's it. Branch → small commits → push often → PR → CI green → merge → delete.

## The traps (and how to dodge each)

| Trap | What goes wrong | Dodge |
|---|---|---|
| **Working directly on `main`** | No review, no safety net, hard to undo | Always branch first. `git-hygiene.sh` warns when you're on main. |
| **Giant commits** | Unreviewable, can't cherry-pick or revert one thing | Commit per logical change. `git add -p` to stage selectively. |
| **Forgetting to pull first** | You branch off stale code → painful merge later | `git pull --rebase` on main before branching. |
| **Work landing from two places** (you + Cursor + a session) | Your branch falls behind; conflicts | Pull-rebase before continuing; run hygiene check with `--fetch`. |
| **Committing junk** | `node_modules`, `.env`, build output, secrets in history | Keep `.gitignore` current; hygiene check flags staged junk. Secrets in history are painful to remove — prevent, don't cure. |
| **Force-pushing a shared branch** | Erases teammates' commits | Never `--force` on shared branches; use `--force-with-lease` only on your own, and only when you understand why. |
| **Long-lived branches** | Diverge far from main, merge hell | Keep branches short; merge or rebase frequently. |
| **Unpushed work for days** | One laptop failure = gone | Push at least daily. Hygiene check reminds you. |

## Good commit messages (60-second version)

- First line: imperative, ≤ ~70 chars — "Add candidate provisioning script", not
  "added stuff".
- Body (optional): *why*, not *what* the diff already shows.
- One concern per commit. If the message needs "and", it's probably two commits.

## Merging safely

- Prefer a **PR + CI green** over a direct merge, even solo — it's the habit that
  scales to a team and catches breakage.
- **Rebase** to keep your branch current (`git pull --rebase`); **merge** to
  combine into main (via the PR). Don't rewrite history that others have pulled.
- If a merge conflict appears: read *both* sides, resolve deliberately, re-run
  tests. Never commit conflict markers (`<<<<<<<`).

## Guardrails to set once (then forget)

- **Branch protection** on `CodeWorthy-ai/CodeWorthy` `main`: require a PR and
  passing CI to merge. This *mechanically* stops un-reviewed or broken code from
  reaching main — the right kind of automation (it keeps you in control rather
  than acting for you). Set it in GitHub → repo Settings → Branches → Add rule.
- **`.gitignore`** covering `node_modules/`, `dist/`, `.env`, `*.log` (already
  present here) — extend it the moment you add a new build artifact.
- **`scripts/git-hygiene.sh`** — run it whenever you're unsure of your repo
  state. It only reports; it never acts.

## When in doubt

Working through Claude Code already handles most of this each session — focused
commits, clear messages, pushing, and rebasing when the branch is behind. If you
want a between-sessions nudge (a scheduled "check your open PRs / unpushed work"
reminder), that can be set up too. Ask.
