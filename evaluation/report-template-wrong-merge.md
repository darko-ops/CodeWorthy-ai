# Candidate Competency Report — ACME-1490 (The Wrong Merge)

**Candidate:** _______  **Assessment:** ACME-1490 (wrong merge resolution)
**Date:** _______  **Time spent:** ___ min (timebox 120)  **Reviewer:** _______
**Submission:** PR link · diff stats (files / +lines / −lines): _______

> This report is shared with the candidate as well as the employer.

## Outcome summary

_Two to four sentences, plain language: what the candidate found, whether the
repair restored all three losses without dropping the export feature, and the
strongest and weakest signals. No recommendation stronger than the evidence._

## Automated verification results

**Red/green baseline check** (`evaluation/baseline-check/`, attach `baseline-record.json`):

| Check | Result |
| --- | --- |
| Candidate's test(s) FAIL on the seeded baseline `M` | ☐ yes ☐ no |
| Same test(s) PASS on the candidate's branch | ☐ yes ☐ no |
| Verdict | ☐ genuine-regression-test ☐ test-theater ☐ broken-on-branch ☐ no-test-changes |

**Hidden evaluation** (attach the `--summary` output; candidates see the summary, never the tests):

| Check | Result |
| --- | --- |
| `authz_check_present` (ops-key guard restored & enforced) | ☐ pass ☐ fail |
| `structured_logging_present` (`order.checkout` fields + `replayed`) | ☐ pass ☐ fail |
| `feature_flag_guard_present` (backorder path restored *as a guard*) | ☐ pass ☐ fail |
| `order_export_intact` (feature survives the repair) | ☐ pass ☐ fail |
| `unrelated_regression` (totals / stock / validation / replay) | ☐ pass ☐ fail |

Seeded-baseline signature is fail/fail/fail/pass/pass; a correct repair turns
1–3 to pass while 4–5 stay pass.

## Workflow events

Facts about how the audit went, before interpretation:

| Event | Outcome |
| --- | --- |
| Found all three losses | ☐ all three ☐ two (ticket symptoms) ☐ one |
| Discovery method | ☐ parent-diff archaeology ☐ orphaned-module grep ☐ symptom-string search only |
| Repair strategy (recorded, never scored) | ☐ forward-fix ☐ revert-and-remerge ☐ reconstruct |
| Export feature preserved | ☐ yes ☐ no |
| Why-green explanation in PR | ☐ present & teachable ☐ thin ☐ absent |
| Stretch finding (unguarded export route) raised | ☐ yes, unprompted ☐ only when asked ☐ no |

## Competency profile

Every rating cites evidence the employer can inspect (line numbers, test names,
quoted defense answers) — a rating that floats without evidence is the
opaque-number problem again. Use **U** for unassessed (ran out of time) — never
score gaps as 1.

Candidate-facing copies use developmental labels: 5–4 → **Strong**, 3 →
**Developing**, 2–1 → **Needs work**, U → **Not assessed**. Evidence lines state
facts about the work, never judgments about the person.

| Competency | Rating (1–5/U) | Evidence |
| --- | --- | --- |
| Codebase comprehension | | |
| Root-cause analysis | | |
| Git discipline & integration | | |
| Testing (red/green gated) | | |
| Security | | |
| Systems thinking | | |
| Communication | | |
| Ownership | | |
| Data safety / Deployment judgment | | |

## AI usage narrative

_What tools they used, how they directed them, what they verified or rejected.
Scored on control, never on quantity of AI use._

## Defense highlights

_Two or three verbatim Q→A excerpts that best support the ratings — strongest
and weakest. The discovery-method answer (defense Q1, run live) and the
why-green answer (Q2) are the anchors._

## Notes for the interview panel

_Specific threads worth pulling in a final conversation (e.g. "found two losses
fast but missed the flag until prompted — probe how they'd audit a merge under
time pressure")._

## What this report does not claim

This assessment observes ~2 hours of work on one production-style task. It does
not measure algorithmic ability, long-horizon collaboration, or domain
knowledge, and scores have not yet been validated against on-the-job
performance.
