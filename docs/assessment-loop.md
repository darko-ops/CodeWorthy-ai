# What We Test Users On — The Assessment Loop

The unit of assessment is not a puzzle, it's a **workflow**. Candidates do the same loop a working engineer does on GitHub every week: pick up a ticket in an unfamiliar repo, get it running, investigate, branch, change, test, open a PR, get through review and CI, and stand behind the change. Every step produces evidence we can score; the workflow *is* the test.

Principle: **we never grade a step we didn't let them actually perform.** No "describe how you would use git" questions — they use git. No "how would you test this" — they push and CI runs.

## The loop

| # | Stage | What the candidate actually does | What we capture | Competencies scored |
|---|-------|----------------------------------|-----------------|---------------------|
| 1 | **Orient** | Gets a private GitHub repo (generated from the simulation template), clones it, gets the app running (`docker compose`, migrate, seed), reads README + TICKET | Time-to-first-run; setup questions asked; whether they read before touching code | Codebase comprehension |
| 2 | **Investigate & reproduce** | Pokes the API/dashboard, reads the ticket's production logs, traces the code path, reproduces the failure (or demonstrates why it happens) | Root-cause section of the PR (required); any repro script/test they commit; terminal activity (with consent) | Root-cause analysis, systems thinking |
| 3 | **Branch** | Creates a feature branch; works in focused commits with real messages | Git history: branch hygiene, commit granularity, message quality, timestamps | Git discipline |
| 4 | **Write the regression test** | Adds a test that **fails on `main`** and encodes the failure condition (not just the happy path) | The test itself; grader re-runs it against baseline — "fails on main" is verified, not taken on faith | Testing |
| 5 | **Fix** | Makes a focused change; adds a migration if the fix needs one; leaves the repo's documented landmines alone | The diff: scope, correctness, convention-match, migration safety | Implementation, data safety |
| 6 | **Verify** | Runs the suite and typecheck locally; pushes — every push triggers CI, so we see their verify loop, not just the final state | CI run timeline per push (red→green sequences are signal, not shame); whether they ran tests before pushing | Testing, AI collaboration (did they verify or trust?) |
| 7 | **Open the PR** | Opens a PR against `main` of their assessment repo and fills in every template section: summary, root cause, fix rationale, testing, data changes, deploy/rollback plan, AI disclosure | The PR body — this is the single richest artifact we collect | Communication, deployment judgment, ownership |
| 8 | **Respond to review** | A reviewer (founder-manual in MVP, AI reviewer later) leaves 1–2 substantive comments — one asking for justification, one proposing a plausible-but-worse alternative. Candidate must defend, adjust, or push back | Review thread: do they cave to a bad suggestion? Explain tradeoffs? Make the requested change cleanly? | Communication, ownership, AI collaboration |
| 9 | **Get CI green** | If CI fails on their branch, they read the logs and fix it — we don't tell them what broke | CI logs + their fixing commits | CI/debugging, testing |
| 10 | **Defense** | Answers ~5 adaptive questions generated from *their* diff, tests, and PR text (bank: `evaluation/defense-questions.md`) | Defense transcript, quoted verbatim in the report | Root-cause analysis, AI collaboration, systems thinking, deployment judgment |

Post-submission (candidate not present): hidden suite runs against their branch (`evaluation/hidden-tests/`) — concurrency, cross-replica, key reuse, unrelated regressions — and the grader verifies their regression test fails on baseline. Results feed the report (`evaluation/report-template.md`).

## Why GitHub is the assessment surface

Everything runs through a real GitHub repo per candidate, because that's where the behaviors we claim to measure actually leave traces:

- **Template repo → private candidate repo.** One click to provision, isolated, disposable. Candidates get collaborator access; `evaluation/` never ships.
- **Commits + branch** are the work log — no keystroke surveillance needed. Timestamps give pacing for free.
- **PR + review thread** are the communication test, in the exact medium the job uses.
- **Actions CI on every push** turns their verification habits into a timeline we can read afterwards.
- Candidates use their own machine, editor, and AI tools — zero unfamiliar tooling between them and the work.

## Signals per stage (what graders look for)

- **Strong:** reproduces before fixing; regression test committed *before* or *with* the fix; commit sequence tells a story; pushes back on the reviewer's worse alternative with a reason; says "I don't know, I'd check X" in defense.
- **Weak:** first commit is a giant diff 20 minutes in (accepted an agent's output wholesale); test that passes on baseline; PR root-cause section restates the symptom; caves instantly to the bad review suggestion; defense answers contradict their own code.
- **Neutral, never penalized:** which AI tools they used, how much they used them, red CI runs they then fixed, asking setup questions.

## What we deliberately do not test

- Algorithms/data-structures recall, syntax trivia, typing speed
- Working without AI or docs (the job allows both; so do we)
- Building anything from scratch — the whole point is brownfield
- Speed beyond the 90-minute box (finishing early earns nothing; unfinished-but-honest is scored on what exists, rest marked unassessed)

## MVP scope vs. later

| Loop stage | MVP (now) | Later |
|---|---|---|
| Repo + PR + CI | Real GitHub repo per candidate, Actions CI | Same, provisioned automatically |
| Review response | Founder posts the 2 review comments manually | AI reviewer generates them from the diff |
| Defense | Live 15-min conversation (founder) | AI-led, adaptive, async |
| Deploy | **Written** deploy/rollback plan in the PR (scored via rubric) | Actual staging deploy the candidate performs, verifies, and rolls back |
| Incident response | Out of scope | Separate simulation track (logs/alerts → triage → hotfix → postmortem) |

The written deploy plan is the honest MVP tradeoff: deployment *judgment* is scorable from text; deployment *execution* needs staging infrastructure we shouldn't build before hypothesis 2 (the assessment separates candidates) is validated.

## One-line version

> Give them a ticket in a repo they've never seen; watch them do the actual job — change, test, PR, review, CI, defense — and score the evidence each step leaves behind.
