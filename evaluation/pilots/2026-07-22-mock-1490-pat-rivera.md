# Candidate Competency Report — ACME-1490 (The Wrong Merge)

**Candidate:** Pat Rivera (**MOCK — dress rehearsal**)  **Assessment:** ACME-1490 (wrong merge resolution)
**Date:** 2026-07-22  **Time spent:** ~35 min wall clock (mock pace; not comparable to a real 120-min run)  **Reviewer:** platform (self-run)
**Submission:** https://github.com/darko-ops/cw-pilot-1490-01/pull/2 · diff stats: 2 files / +111 / −8 / 3 commits

> **Mock-run caveat, read first.** The "candidate" was the platform's own agent
> with prior knowledge of the seeded history. Every row that depends on
> *discovery* (comprehension, root-cause, ownership) is therefore
> **non-probative about a real candidate** and is rated only to validate that
> the report pipeline can express such ratings. The automated sections are real
> measurements. The defense was not conducted. This report validates the
> reporting instrument, not a person.

## Outcome summary

The submission identified the whole-file "accept incoming" resolution as the
cause, named all three lost behaviors (including the unreported flag guard),
restored them via forward-fix without touching the export feature, and closed
the loop red→green in real CI. Strongest signal: the red-phase discipline and
the why-green explanation. Notable real event: the first repair push failed
CI on `tsc` (NodeNext requires an explicit extension on a dynamic import) and
was diagnosed and fixed from the CI log in one commit — an authentic
recovery-under-CI moment this scenario wasn't even designed to seed.

## Automated verification results

**Red/green baseline check** (grading-record: verdict from
`scripts/grade-submission.sh`, baseline `9997d60`):

| Check | Result |
| --- | --- |
| Candidate's test(s) FAIL on the seeded baseline `M` | ☑ yes |
| Same test(s) PASS on the candidate's branch | ☑ yes |
| Verdict | ☑ **genuine-regression-test** |

**Hidden evaluation** (sanitized `--summary`):

| Check | Result |
| --- | --- |
| `authz_check_present` | ☑ pass |
| `structured_logging_present` | ☑ pass |
| `feature_flag_guard_present` | ☑ pass |
| `order_export_intact` | ☑ pass |
| `unrelated_regression` | ☑ pass |

All rubric gates satisfied — no competency capped.

## Workflow events

| Event | Outcome |
| --- | --- |
| Found all three losses | ☑ all three (flag guard named in PR though absent from ticket) * |
| Discovery method | ☑ parent-diff archaeology (`git diff 8444911 9997d60`) + orphaned-module grep * |
| Repair strategy (recorded, never scored) | ☑ forward-fix |
| Export feature preserved | ☑ yes (`order_export_intact: pass`) |
| Why-green explanation in PR | ☑ present & teachable (coverage gap + test-silenced logger + whole-file resolution) |
| Stretch finding (unguarded export route) raised | ☑ yes, unprompted — flagged as a product decision, deliberately not shipped |

\* non-probative in a mock run (prior knowledge); recorded to exercise the table.

## Competency profile

| Competency | Rating (1–5/U) | Evidence |
| --- | --- | --- |
| Codebase comprehension | 4 * | PR cites the exact parent-diff command and the three orphaned breadcrumbs (`opsKey.ts`, `flags.ts`, `createBackorder`) with zero importers |
| Root-cause analysis | 4 * | PR names the resolution event as the cause and the three losses as consequences, mapping each to its production symptom |
| Git discipline & integration | 5 | Red commit (tests only, CI red on the target assertions) → green commit (repair) → surgical typecheck fix; export preserved; no history damage |
| Testing (red/green gated) | 5 | Verdict `genuine-regression-test`; three tests cover all three losses; log observation designed deliberately (`LOG_IN_TESTS` + stdout interception) |
| Security | 4 | Guard restored and enforced (`authz_check_present: pass`); unguarded export raised unprompted with tenant-leak blast radius; 5 reserved for defense corroboration |
| Systems thinking | 4 | Monitor-flatline failure mode articulated; flag semantics tied to pilot env; rollback noted as re-opening the data leak |
| Communication | 5 | Why-green section is teachable; handoff executable by a stranger (deploy, three verifications, rollback trigger, least-sure item) |
| Ownership | 4 * | Third loss found and fixed without a ticket pointer; open question surfaced rather than silently resolved |
| Data safety / Deployment judgment | 4 | App-only change correctly identified (no migration); per-behavior post-deploy verifications; security-page caveat on rollback |
| AI collaboration | U | Not applicable — the mock candidate *is* an AI agent run by the platform; no disclosure/defense loop occurred |

## AI usage narrative

Not applicable for this mock run (see caveat). For real pilots this section is
filled from the candidate's disclosure and corroborated in the defense.

## Defense highlights

**Not conducted** — the defense requires a human candidate. For real pilots,
Q1 (discovery method, run live) and Q2 (why green CI missed it) anchor this
section, plus the mandatory export-access-posture question
(`docs/hidden-suite-requirements.md`).

## Notes for the interview panel

Pipeline-validation observations rather than candidate notes:

- **Real finding:** the repo's NodeNext `tsconfig` rejects extensionless
  dynamic imports that vitest happily runs — candidates writing
  env-before-import tests will hit red CI on `npm run typecheck` exactly as
  this run did. Genuine, fair friction (repo conventions; the CI log names the
  file and fix) — keep it, but expect it in pilots.
- Local grading (vitest-only) cannot catch typecheck failures; CI can. A real
  candidate's "get CI green" step is doing work the grading script does not.

## What this report does not claim

This assessment observes ~2 hours of work on one production-style task. It does
not measure algorithmic ability, long-horizon collaboration, or domain
knowledge, and scores have not yet been validated against on-the-job
performance. **Additionally, as a mock run by the platform's own agent, this
instance makes no claim about any person.**
