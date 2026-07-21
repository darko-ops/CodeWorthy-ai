# Mission-Control Design Mockups

`codeworthy-mockups.html` is a standalone, self-contained design canvas — open it in any browser. Two sets share one bold direction (navy + green):

## Screen inventory

**Desktop (1a–1l)**

| # | Screen |
|---|---|
| 1a | Landing — editorial hero + live evidence card |
| 1b | Hiring dashboard — dark mission control |
| 1c | Candidate report — competency data-viz centerpiece |
| 1d | Exam detail — examinee mission brief (per-step `auto check` / `pending review` labels) |
| 1e | Login — split brand panel + role toggle (assessment / hiring) |
| 1f | Learn — assessment track list (examinee) |
| 1g | Settings (merchant) — org, review policy, notifications |
| 1h | Invite candidate — assessment picker + invite email preview |
| 1i | Team management — Owner / Reviewer / Viewer roles |
| 1j | Billing & plan — Team $499/mo, Scale $1,499/mo |
| 1k | Candidate compare — side-by-side profiles + recommendation |
| 1l | Your result (examinee) — profile, share controls, growth edge |

**Mobile (2a–2n)** — the same direction adapted for phone, plus candidate list, notifications, and candidate detail with the pipeline (invited → in progress → submitted → in defense → report).

## Alignment with the architecture

The designs already honor the hard rules in [`../mvp-architecture.md`](../mvp-architecture.md):

- Mission-brief steps are labeled **auto check** vs **pending review** (Principle 2, verbatim).
- The report shows the **`genuine-regression-test` verdict** and per-check hidden-suite results — ids only, never test internals (Principles 1 and 5). The engine emits exactly these ids: `concurrent_same_key_retry`, `cross_replica_dedup`, `reused_key_distinct_checkout`, `no_key_checkout`, `unrelated_regression` (`evaluation/hidden-tests/summarize.mjs`).
- Compare view footnotes *"Not assessed is never counted as a failure."*
- Candidates own report sharing; every rating carries an evidence line.
- The invite flow names two future assessments that map to the [behavior catalog](../behavior-catalog.md) backlog: **ACME-1310** (retire legacy endpoints — Maintainer) and **ACME-1355** (red-to-green CI rescue — Release engineer).
- Settings introduces two review-policy ideas worth adopting into the grading docs: **blind first pass** and **two-reviewer release**.

## Open conflicts (decide before build)

1. **Overall score (4.1 / 5.0).** Centerpiece of most screens, but the architecture forbids reducing to a single number. Decide: drop it, or amend the rule to allow a clearly-labeled competency average that never appears without the profile and is never a pass/fail.
2. **Timebox.** Mockups say **4h**; concept doc and ASSESSMENT.md say the standardized assessment stays **under 90 minutes**. Reconcile before invite-email copy is built.
