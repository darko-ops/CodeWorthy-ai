# Candidate Competency Report

**Candidate:** _______  **Assessment:** ACME-1287 (duplicate order on checkout retry)
**Date:** _______  **Time spent:** ___ min (target 90)  **Reviewer:** _______
**Submission:** PR link · diff stats (files / +lines / −lines): _______

> This report is shared with the candidate as well as the employer.

## Outcome summary

_Two to four sentences, plain language: what the candidate did, whether the fix survives production conditions, and the strongest and weakest signals. No recommendation stronger than the evidence._

## Hidden evaluation results

| Suite | Result |
| --- | --- |
| Visible test suite still green | ☐ pass ☐ fail |
| Concurrent same-key retry → one order, one charge | ☐ pass ☐ fail |
| Cross-replica / restart retry → one order | ☐ pass ☐ fail |
| Distinct keys still create distinct orders | ☐ pass ☐ fail |
| No-key checkout unaffected | ☐ pass ☐ fail |
| Stock / totals / validation regressions | ☐ pass ☐ fail |
| Candidate's regression test fails on baseline | ☐ yes ☐ no |

## Competency profile

Every rating must cite evidence the employer can inspect (line numbers, test names, quoted defense answers). Use **U** for unassessed (ran out of time) — do not score gaps as 1.

| Competency | Rating (1–5/U) | Evidence |
| --- | --- | --- |
| Codebase comprehension | | |
| Root-cause analysis | | |
| Implementation | | |
| Testing | | |
| Systems thinking | | |
| Data safety | | |
| Git discipline | | |
| AI collaboration | | |
| Communication | | |
| Deployment judgment | | |

## AI usage narrative

_What tools they used, how they directed them, what they verified or rejected. Scored on control, never on quantity of AI use._

## Defense highlights

_Two or three verbatim Q→A excerpts that best support the ratings above — strongest and weakest._

## Notes for the interview panel

_Specific threads worth pulling in a final conversation (e.g. "ask them about idempotency-key retention — they flagged it but didn't implement it")._

## What this report does not claim

This assessment observes ~90 minutes of work on one production-style task. It does not measure algorithmic ability, long-horizon collaboration, or domain knowledge, and scores have not yet been validated against on-the-job performance.
