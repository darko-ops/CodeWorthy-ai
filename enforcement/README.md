# CodeWorthy Enforcement Tier

Turns the checkup engine from "a report you run" into **a senior engineer that's
always watching and blocks bad merges.** This is tier 3 of the Steward product
(see [`../docs/ai-senior-engineer-policy.md`](../docs/ai-senior-engineer-policy.md)).

## The key decision: no hosted app needed for the MVP

Real enforcement — gate the merge, advise on the diff, keep an audit trail —
ships today as **GitHub Actions + branch protection**, no server to run:

- `pr-review.mjs` reviews the PR diff and **exits non-zero on a blocking finding**.
- `pr-checkup.yml` runs it on every PR, posts a plain-language review comment,
  and surfaces that exit code as a check.
- Make the check **required** in branch protection → a blocking finding blocks
  the merge. That's the enforcement.

A **hosted GitHub App** is the tier above this — it adds what Actions can't do
well: auto-configuring branch protection for a non-engineer, the *safe-mechanics*
(auto-create a branch when someone edits main, draft the PR), cross-repo
dashboards, and durable audit storage. Build it when the Actions MVP has proven
demand — not before.

## Install (per repo)

1. Copy `pr-checkup.yml` to the repo's `.github/workflows/codeworthy.yml`.
2. If the CodeWorthy tool repo is private, add a read-only PAT as the
   `CODEWORTHY_TOKEN` secret and uncomment the `token:` line.
3. Turn on branch protection for `main`: require the **CodeWorthy PR review**
   check to pass before merging. (This is exactly the step the hosted App would
   automate for a non-engineer.)

That's the whole install: one workflow file + one branch-protection toggle.

## What the PR gate checks (`pr-review.mjs`)

Reviews the diff of `base...head`. **GATE** = blocks the merge; **ADVISE** =
comments, human decides.

| Finding | Severity | Why |
|---|---|---|
| Secret introduced (AWS/GitHub/Stripe/API keys, private keys, JWTs, hard-coded creds) | **GATE** | A leaked secret is the highest-cost, hardest-to-undo mistake |
| `.env` committed | **GATE** | Secrets don't belong in git |
| `node_modules` committed | **GATE** | Bloats history, should be gitignored |
| Destructive migration (`DROP TABLE/COLUMN`) | **GATE** | Permanent data loss |
| `NOT NULL` column without default | ADVISE | Fails on a table with existing rows |
| Source changed with no test in the PR | ADVISE | Nothing proves the change works or stays working |
| Large PR (>20 files / ~400 lines) | ADVISE | Hard to review and to undo |
| Vague commit messages | ADVISE | Unreadable history |

```bash
# run it locally too:
node enforcement/pr-review.mjs --repo . --base main --head my-branch
# exit 0 = mergeable, 2 = blocked
```

Secret patterns are shared with the checkup engine
([`../checkup/secret-patterns.mjs`](../checkup/secret-patterns.mjs)) so the two
can't drift.

## The audit trail (SOC 2 seed)

Every review appends a JSON line: timestamp, repo, base/head, actor, the
decision, and the finding ids — an immutable record of *what was evaluated and
what was decided*, which is exactly the change-management evidence SOC 2 asks
for. In the Actions MVP it's uploaded as a build artifact; the **compliance
tier** persists it to durable append-only storage and renders it as a
plain-language change log.

## What's deterministic (here) vs. the judgment tier (next)

Everything above is deterministic — no LLM, fully inspectable, runs in a plain
CI job. The **judgment tier** adds an LLM reviewer using the competency rubric
as its prompt: duplication, contract-breaking changes, backwards-compat
reasoning, "is this test meaningful," and the pre-merge micro-defense. It layers
on top; the deterministic gates always run first and for free.

## The invariant (non-negotiable)

CodeWorthy **never merges, force-pushes, or rewrites history.** It gates and
advises; the human owns every merge. The guardrail must not become another
unreviewed actor — that's CodeWorthy's "stay in control" principle applied to
the tool itself.
