# Candidate Competency Report

**Candidate:** _______  **Assessment:** ACME-1287 (duplicate order on checkout retry)
**Date:** _______  **Time spent:** ___ min (target 90)  **Reviewer:** _______
**Submission:** PR link · diff stats (files / +lines / −lines): _______

> This report is shared with the candidate as well as the employer.

## Outcome summary

_Two to four sentences, plain language: what the candidate did, whether the fix survives production conditions, and the strongest and weakest signals. No recommendation stronger than the evidence._

## Automated verification results

**Red/green baseline check** (`evaluation/baseline-check/`, attach `baseline-record.json`):

| Check | Result |
| --- | --- |
| Candidate's test FAILS on pristine baseline | ☐ yes ☐ no |
| Same test PASSES on candidate's branch | ☐ yes ☐ no |
| Verdict | ☐ genuine-regression-test ☐ test-theater ☐ broken-on-branch ☐ no-test-changes |

**Hidden evaluation** (attach the `--summary` output; candidates see the summary, never the tests):

| Suite | Result |
| --- | --- |
| Visible test suite still green | ☐ pass ☐ fail |
| Concurrent same-key retry → one order, one charge | ☐ pass ☐ fail |
| Cross-replica / restart retry → one order | ☐ pass ☐ fail |
| Distinct keys still create distinct orders | ☐ pass ☐ fail |
| No-key checkout unaffected | ☐ pass ☐ fail |
| Stock / totals / validation regressions | ☐ pass ☐ fail |

## Workflow events

What actually happened during the loop (facts, before interpretation):

| Event | Outcome |
| --- | --- |
| Clarified or documented the Northfield replay-vs-conflict decision | ☐ asked in issue ☐ documented assumption ☐ neither |
| Red phase: regression test pushed before fix, failed in CI | ☐ yes, for the right reason ☐ yes, wrong reason ☐ no red phase |
| Recovery: harness tripwire encountered | ☐ diagnosed & fixed ☐ worked around destructively ☐ stuck ☐ not triggered (U) |
| Upstream change integrated | ☐ clean, teammate's work preserved ☐ integrated with losses ☐ never integrated |
| Superseded cache-cap change explained | ☐ yes ☐ no ☐ n/a |
| Review: correctness concern | ☐ resolved ☐ deflected |
| Review: inferior (Redis) suggestion | ☐ evaluated & declined/discussed ☐ blindly adopted ☐ blindly dismissed |
| Review: contract concern | ☐ addressed ☐ ignored |
| Handoff comment posted | ☐ executable by a stranger ☐ thin ☐ missing |

## Competency profile

Every rating must cite evidence the employer can inspect (line numbers, test names, quoted defense answers) — a rating that floats without evidence is the opaque-number problem again. Use **U** for unassessed (ran out of time) — do not score gaps as 1.

Candidate-facing copies use developmental labels, never scores or "failed": 5–4 → **Strong**, 3 → **Developing**, 2–1 → **Needs work**, U → **Not assessed**. The evidence line stays a fact about the work ("your test did not fail against simultaneous requests on the baseline"), never a judgment about the person.

| Competency | Rating (1–5/U) | Evidence |
| --- | --- | --- |
| Codebase comprehension | | |
| Root-cause analysis | | |
| Implementation | | |
| Testing (incl. red phase) | | |
| CI recovery | | |
| Systems thinking | | |
| Data safety | | |
| Git discipline & upstream integration | | |
| Team communication (clarify, review, handoff) | | |
| AI collaboration | | |
| Deployment judgment | | |
| Ownership | | |

## AI usage narrative

_What tools they used, how they directed them, what they verified or rejected. Scored on control, never on quantity of AI use._

## Defense highlights

_Two or three verbatim Q→A excerpts that best support the ratings above — strongest and weakest._

## Notes for the interview panel

_Specific threads worth pulling in a final conversation (e.g. "ask them about idempotency-key retention — they flagged it but didn't implement it")._

## What this report does not claim

This assessment observes ~90 minutes of work on one production-style task. It does not measure algorithmic ability, long-horizon collaboration, or domain knowledge, and scores have not yet been validated against on-the-job performance.
