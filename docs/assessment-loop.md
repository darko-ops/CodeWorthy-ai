# What We Test Users On — The Assessment Loop

The unit of assessment is not a puzzle, it's a **workflow** — and not a solo workflow. The candidate joins a repository where work is already happening: they investigate an ambiguous problem, create a failing test, recover from a CI failure they didn't plan, incorporate a teammate's change, navigate review, and leave the work safe for someone else to deploy.

(This document defines *what* is tested; [mvp-architecture.md](mvp-architecture.md) defines *how* the platform delivers and verifies it — verification modes, the red/green baseline check, hidden-test isolation, and scoring output.)

The governing principle:

> **Every candidate must encounter uncertainty, visible failure, and another engineer's competing perspective — and recover through the normal team workflow.**

Two design rules follow from it:

1. **We never grade a step we didn't let them actually perform.** No "describe how you would use git" — they use git. No "how would you handle CI failing" — CI fails, visibly, during the assessment, and we watch the recovery.
2. **They may be unfamiliar with the solution — never confused about the rules.** Every failure we put in front of them comes with evidence (a CI log, a stack trace, a database error, a reviewer observation, a conflicting upstream change). Failures caused by undocumented setup, broken infrastructure, hidden commands, evaluator mind-reading, or intentional flakiness are defects in the assessment, not signal about the candidate.

## The loop

| # | Stage | Candidate action | Signal |
|---|-------|------------------|--------|
| 1 | **Orient** | Clone the private repo (stamped from the simulation template), get the app running, read README + ticket | Codebase comprehension |
| 2 | **Clarify** | The ticket contains one meaningful product ambiguity. Ask in the issue, or state and document an assumption | Team communication |
| 3 | **Reproduce** | Demonstrate the production failure (or show convincingly why it happens) | Investigation |
| 4 | **Red test** | Push a regression test *before* the fix; CI runs it against the unfixed code and **fails for the intended reason** | Test quality, CI literacy, red-green discipline |
| 5 | **Implement** | Make a focused fix (migration if needed), push | Correctness and judgment |
| 6 | **Recover CI** | One realistic failure they did not directly plan for surfaces in CI. Read the logs, decide "my code or the environment?", correct it | Debugging and resilience |
| 7 | **Integrate** | A teammate merges a small relevant change into `main` while their PR is open. Notice, understand it, rebase/merge, resolve a small conflict, rerun verification, preserve the teammate's work | Collaborative Git usage |
| 8 | **Open PR** | Fill every template section: root cause, fix rationale, testing, data changes, risk | Written communication |
| 9 | **Review** | The reviewer opens one required tradeoff thread (plus at most one optional second). Accept, reject with justification, propose alternatives, or ask — through GitHub | Collaboration and ownership |
| 10 | **Handoff** | Final PR comment written for the teammate who will deploy it: what changed, which migration runs, what to monitor, what triggers rollback, what remains uncertain | Operational teamwork |
| 11 | **Defend** | Answer ~5 adaptive questions grounded in their actual diff | Understanding |
| 12 | **Hidden evaluation** | (Candidate absent) The red/green baseline check (`evaluation/baseline-check/`) mechanically verifies their test fails on the pristine baseline and passes on their branch; the private suite covers concurrency, cross-replica, key reuse, regressions | Final technical validity |

## CI: mandatory red, green, and recovery

The hidden suite can't test CI debugging — the candidate never sees it. So CI failure is built into the assessment itself, in three phases:

**Red phase.** After reproducing the bug, the candidate pushes their regression test (draft PR or direct push) *before* implementing the fix. CI runs against the unfixed implementation and must fail — for the reason they intended. This proves the test genuinely detects the bug, that they're comfortable presenting a red build, and that they can read CI output and confirm it matches expectation. The proctor checks the red run's failure reason against the candidate's stated root cause.

**Green phase.** They implement the fix and push. Candidate CI runs unit + integration tests, type checking, migration validation (upgrade path from `main`'s schema, not just a clean database), and build verification (API + dashboard). They inspect the run and get it green.

**Recovery phase.** The assessment contains one additional realistic failure the candidate didn't plan. In the current simulation it's seeded structurally: the canonical database-backed fix adds a table referencing `orders`, and the existing test harness resets state with a plain `TRUNCATE order_items, orders` — which Postgres refuses once a new table holds a foreign key to `orders`. Their targeted test passes; the rest of the suite goes red with a real database error. They must read it, recognize the failure is in the *test environment's assumptions* rather than their fix logic, and correct the harness as part of their change. It is diagnostic (clear error, points at the exact line), realistic (this happens in real codebases weekly), and not a trick.

What we measure in a recovery is the method, not the stumble: stay methodical → gather information → form a hypothesis → use docs/AI effectively → test the hypothesis → correct it → explain what happened afterward.

## Team behavior through actual interaction

Responding to comments is not teamwork by itself. Four interaction points make the teammate real:

**A. Requirements clarification.** The ticket carries one genuine product decision, not missing trivia — e.g. *when a duplicate request does arrive, should the second caller receive the original order's response, or an explicit conflict their integration can handle?* Both prevent the duplicate charge; they produce different customer behavior. Asking in the issue is strong; silently choosing but *documenting the assumption and its tradeoff in the PR* is equally strong. Silently choosing without a trace is the weak signal. We score recognition and communication of the decision, not question-asking per se.

**B. Review from another engineer.** Minimal by design — one required thread, at most two (scripts in `evaluation/proctor-playbook.md`). The required thread forces a **real tradeoff**, not a cosmetic nit: the reviewer suggests a Redis-based lock, and the strong response identifies lock-expiration and durability risks and argues for the database constraint. Reply *presence* is a live-automated fact; reply *quality* is scored by a human and probed in the defense — the defense, not the thread, carries the anti-gaming weight, because a circulated "right answer" collapses when the candidate must justify it against a variant of the tradeoff.

The goal is not "push back." Blind resistance scores no better than blind compliance. The signal: *can they evaluate feedback independently and move the shared work toward the correct outcome?*

**C. Upstream change.** While their PR is open, a teammate's small, relevant commit lands on `main` (prepared patch in `evaluation/upstream-change/`). Their branch is now behind and conflicts slightly. They must notice, understand the change, rebase or merge, resolve the conflict, rerun verification, and not erase the teammate's work — including the harder judgment call when part of the teammate's change is *obsoleted* by their fix and the correct resolution is to supersede it, with an explanation in the PR. The conflict stays small by design: we're testing integration judgment, not Git-command memorization.

**D. Handoff.** Before finishing, a final PR comment addressed to the engineer deploying it: what changed, what migration must run and in what order, what to monitor, what would trigger rollback, what remains uncertain. This tests whether they leave work usable by someone who wasn't in their head.

## Evidence and telemetry: what we score, what we refuse to

Git and GitHub artifacts are **evidence, not a complete record**. Candidates amend, squash, reset, work locally for an hour, or have an agent perform many operations between pushes — all legitimate. So:

**Never scored:** commit count, time-to-first-commit, typing/command volume, whether their Git style matches a preferred workflow, red CI runs that were subsequently fixed, which AI tools they used or how much.

**Scored:** whether the changes are reviewable; whether the regression test is independently verifiable (fails on baseline when *we* run it); whether commits separate meaningful stages when it matters; whether they use CI results intelligently; whether upstream work survives their integration; whether the final history, PR, and handoff let a teammate understand and operate the change.

## What we deliberately do not test

- Algorithms/data-structures recall, syntax trivia, typing speed
- Working without AI or documentation (the job allows both; so do we)
- Building anything from scratch — the whole point is brownfield
- Speed beyond the 90-minute box (unfinished-but-honest is scored on what exists; gaps are marked unassessed, not failed)

## MVP scope vs. later

| Loop element | MVP (now) | Later |
|---|---|---|
| Repo + PR + CI | Real GitHub repo per candidate, Actions CI (`evaluation/candidate-repo/ci.yml`) | Auto-provisioned |
| Red-phase confirmation | Proctor eyeballs the red run's failure reason | Automated check that failure matches the seeded bug's signature |
| Review comments | Proctor posts the required tradeoff thread (+ optional second) | AI reviewer generates them from the actual diff |
| Upstream change | Proctor applies the prepared teammate patch to `main` | Scheduled bot merge, variant per scenario |
| Recovery failure | One structural tripwire (harness vs. FK) | Parameterized library of recovery conditions |
| Handoff + defense | Live, founder-led | AI-led, async |
| Deploy | Written deploy/rollback plan, scored via rubric | Actual staging deploy the candidate performs, verifies, rolls back |
| Incidents | Out of scope | Separate simulation track |

## One-line version

> Join a repository where work is already happening. Investigate an ambiguous problem, prove the bug with a red build, recover from a failure you didn't plan, absorb a teammate's change, navigate review, and leave the work safe for someone else to deploy.
