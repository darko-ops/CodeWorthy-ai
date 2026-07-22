# Phase 0 Validation — Dress-Rehearsal Evidence (2026-07-22)

Full-loop rehearsal of both scenarios before inviting real candidates:
provision → candidate submission → automated grading, run end-to-end with the
committed scripts only. Every result below is reproducible with the commands
shown. The human half of the exit gate (5 real candidates, reports reviewed by
experienced engineers) remains open — this rehearsal proves the machinery is
ready for it.

## ACME-1287 (acme-orders)

Provisioned via `scripts/provision-candidate.sh --scenario acme-orders --dry-run`
(assembled tree: single bootstrap commit, candidate CI, zero private files —
leak check passed).

| Submission | Baseline-check verdict | Hidden suite | automatedChecksAllGreen |
|---|---|---|---|
| Reference fix + real regression tests (concurrent + cross-replica) | `genuine-regression-test` | 5/5 pass | **true** |
| Reference fix + sequential-only test (test theater) | **`test-theater`** | 5/5 pass | **false** |

The second row is the differentiation proof: a submission with a perfect fix
but a worthless test grades visibly differently — the rubric caps its testing
row at 2 on the verdict alone. "Good fix, bad evidence" and "good fix, good
evidence" cannot be confused.

Not exercisable without a live candidate: the Stage-6 recovery tripwire
experience (the reference patch already includes the CASCADE repair) and the
upstream/review/defense loop — these are precisely what the human pilots
observe.

## ACME-1490 (wrong-merge)

Provisioned via `scripts/provision-candidate.sh --scenario wrong-merge --dry-run`
(stamped from the bundle: overlay commit directly atop locked merge `9997d60`,
full three-author graph, breadcrumbs verified, leak check passed).

| Submission | Baseline-check verdict | Hidden suite | automatedChecksAllGreen |
|---|---|---|---|
| Reference repair + regression tests (authz + flag) | `genuine-regression-test` | 5/5 pass | **true** |
| Untouched baseline (no repair) | `no-test-changes` | fail / fail / fail / pass / pass | **false** |

The baseline row reproduces the calibrated seed signature exactly, matching
the CI guard (`wrong-merge-seeded-state`).

## Environment note

Grading requires `psql` on PATH (documented in `scripts/grade-submission.sh`);
on this machine: `brew install libpq` + `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.

## What remains for the Phase 0 exit gate (human-only)

- [ ] Run 5 real candidates through ACME-1287 (provision for real — drop
      `--dry-run`; proctor per `evaluation/proctor-playbook.md`).
- [ ] Grade each with `scripts/grade-submission.sh`, then complete the human
      half: defense + report per `evaluation/grading-workflow.md`.
- [ ] Hand the reports to experienced engineers **without conclusions** and
      confirm strong and weak submissions produce visibly different reports.
- [ ] If they don't differentiate, fix the scenario/rubric — not the tooling —
      before Phase 1.
- [ ] Then one pilot of ACME-1490 end to end.
