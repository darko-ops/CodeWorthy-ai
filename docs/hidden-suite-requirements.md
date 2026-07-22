# Hidden-Suite Requirements — Wrong-Merge Scenario (ACME-1490)

Binding requirements for `evaluation/hidden-tests-wrong-merge/`. The suite is
calibrated against the locked candidate baseline `9997d60` (the bad merge).
Verified signatures: baseline `fail/fail/fail/pass/pass`; correct repair
`pass ×5`.

## Requirement A — enforcement, not presence

`authz_check_present` exercises the LIVE `GET /api/orders` route against the
ops-key matrix (no key → 401, wrong key → 403, correct key → 200, scoped
`?customerId=` → 200 keyless). It never inspects source. A candidate who
restores `src/middleware/opsKey.ts` as a file without wiring the guard into
the route FAILS (adversarially verified).

## Requirement B — functionality, not verbatim code

`order_export_intact` asserts `GET /api/orders/export` returns correct CSV —
not that Alex Kimura's implementation survived. A consolidated rewrite PASSES;
a revert-the-merge "repair" (which throws the export away) FAILS (both
adversarially verified). The check supplies the ops key on the request so a
candidate who chose to guard the export is not penalized.

## Requirement C — error-path leak guard (BLOCKING)

`leak-guard.mjs` is the standing proof that the sanitized `--summary` output
leaks nothing on error paths. It injects two fault states into a scratch copy
(a throw before any assertion runs; a hang that times every check out), runs
the real `run.sh --summary` pipeline, and asserts the output is exactly
`{check id, label, pass|fail|not-run}` with no stack traces, assertion text,
file paths, or error bodies — canary-verified on both streams.

**Run it in CI and after ANY edit to `summarize.mjs`, `run.sh`, or the hidden
test file. Nothing goes candidate-facing while it is red.** A leaked hidden
test is a dead assessment; a wrong verdict is only a dispute.

## Isolation (unchanged from the platform design)

Hidden tests live only in this private repo; `run.sh` copies them into the
target repo for the duration of a grader-controlled run and deletes them on
exit. Candidate branches are untrusted input: no secrets, no network path to
hidden-test credentials, hidden checkout happens after — never interleaved
with — running candidate code. The sanitized `--summary` is the only egress
to any candidate-facing surface.

## Public check-id contract

`authz_check_present` · `structured_logging_present` ·
`feature_flag_guard_present` · `order_export_intact` · `unrelated_regression`
— rendered verbatim in candidate and employer surfaces; renaming is a
breaking product change.

## Defense set — MANDATORY question (record; built with the defense bank)

**The access-control posture of the export endpoint must be probed in every
defense for this scenario:**

> "Should `GET /api/orders/export` require the ops key? Whose mistake is it
> that it doesn't?"

Rationale: the export is a bulk read of every customer's orders, and it ships
unguarded because Alex's branch predates Priya's auth commit (ACME-1461). It
is deliberately NOT a scored hidden check — "restoration" is undefined for a
behavior the feature never had — so the defense is the only place this
senior-level finding becomes legible. Making the question mandatory is what
makes "found it" vs. "missed it" distinguishable in the report. Listen for:
the timeline reasoning (process gap, not negligence), the tenant-leak blast
radius, and the judgment that guarding it is a product decision to raise —
not to ship silently.
