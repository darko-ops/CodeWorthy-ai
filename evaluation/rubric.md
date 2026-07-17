# Scoring Rubric — ACME-1287 (Duplicate order on checkout retry)

Score each competency 1–5 with cited evidence (diff, tests, PR text, defense answers, hidden-test results). Never collapse to a single number. Mark competencies the candidate ran out of time for as **unassessed**, not 1.

## The seeded bug (reviewer context)

`OrderService` "handles" idempotency with a **per-process in-memory Map that is only written after payment capture completes**. It therefore fails when:

1. a retry arrives while the original request is still in flight (the map isn't written yet) — this is what the ticket's logs show;
2. the retry lands on a different replica (production runs two) or after a restart/deploy;
3. the map is cleared by its crude 5,000-entry cap.

The sequential visible test passes, which is deliberate false confidence. The correct fix moves idempotency into Postgres (e.g. a keyed table written inside the order transaction with a unique constraint, replaying the stored order on conflict). See `evaluation/reference-solution/`.

Two more seeded elements (see `evaluation/proctor-playbook.md`): the **recovery tripwire** — the test harness truncates `orders` without CASCADE, so a fix that adds a table with a FK to `orders` breaks the rest of the suite with a real Postgres error the candidate must diagnose mid-assessment — and the **upstream teammate change**, which conflicts with the candidate's edit and is partly obsoleted by it.

## Competency anchors for this challenge

### Root-cause analysis
- **5** — Identifies the write-after-completion race *and* the per-process scope; connects both to the two incidents (dashboard timeout retry, cross-replica integration retry).
- **4** — Identifies that the in-memory map cannot provide the guarantee; fix is DB-backed.
- **3** — Sees the race window but fix still has a gap (e.g. writes the map earlier, adds a mutex — single-process only).
- **2** — Patches a symptom (e.g. dedupes by customer+total+time window; disables client retry).
- **1** — Cannot explain why duplicates occur; change is unrelated to the cause.

### Implementation
- **5** — DB-backed idempotency, race-safe (unique constraint / ON CONFLICT), replays the original response, focused diff, matches repo conventions.
- **4** — Correct and race-safe; minor rough edges (e.g. unbounded key table with no retention note).
- **3** — Works sequentially and across replicas but has a concurrency hole (check-then-insert without a constraint).
- **2** — Passes visible tests only; hidden suite fails.
- **1** — Breaks existing behavior or visible tests.

### Regression testing

Gated by the red/green baseline check (`evaluation/baseline-check/`): only verdict `genuine-regression-test` (fails on pristine baseline AND passes on the branch) can score above 2. `test-theater` caps this row at 2 regardless of how the tests read.

- **5** — Baseline check passes; covers concurrent same-key retry *and* cross-instance/restart; keeps distinct-key behavior covered.
- **4** — Baseline check passes; covers concurrency **or** cross-instance.
- **3** — Baseline check passes but only via a marginal condition; or sequential-only test that happens to fail on baseline for a fragile reason.
- **2** — `test-theater`: tests would pass on the buggy code.
- **1** — No meaningful test (`no-test-changes`).

### Data safety
- **5** — Additive migration, backwards compatible with the running release (README documents migrate-before-deploy), considers retention/cleanup of key rows, no locking foot-guns.
- **4** — Additive and safe; retention unconsidered.
- **3** — Works but couples deploy ordering without noting it.
- **2** — Destructive or incompatible change (e.g. rewrites orders table, adds NOT NULL without default).
- **1** — Migration would fail or lose data.

### Systems thinking
- **5** — Reasons about replicas, in-flight overlap, stock/charge side effects, and what the 409-vs-replay choice means for integrators.
- **3** — Handles the single-process story only.
- **1** — No consideration beyond "test passes."

### Requirements clarification (Stage 2 — the Northfield question)
- **5** — Recognizes the replay-vs-conflict decision as a *product* question; either asks Sam in the issue or documents the chosen behavior and its integration consequences in the PR.
- **4** — Chooses deliberately and documents the assumption, without surfacing the tradeoff for integrators.
- **3** — Mentions the ambiguity only when review comment 3 forces it.
- **2** — Silently picks a behavior; no trace of the decision anywhere.
- **1** — Doesn't realize the two behaviors differ.
- Note: asking is not automatically better than documenting a sound assumption. Score recognition + communication, not question-asking.

### CI literacy — red phase (Stage 4)
- **5** — Pushes the regression test before the fix; red run's failure matches their stated root cause; says so ("fails because two orders exist, as expected").
- **4** — Red phase achieved; failure reason correct but unremarked.
- **3** — Test and fix pushed together; test verified against baseline only when the grader does it.
- **2** — Red run is red for the wrong reason (broken setup, unrelated error) and they don't notice.
- **1** — Never pushes a failing state; test passes on baseline.

### Recovery (Stage 6 — the harness tripwire)
- **5** — Reads the FK/TRUNCATE error, attributes it correctly ("my schema change broke the harness's reset assumption"), fixes the harness as part of the change, mentions it in the PR.
- **4** — Diagnoses and fixes it cleanly; no mention in the PR.
- **3** — Fixes it after thrashing (reverting their migration, blaming flakiness) but gets there methodically in the end.
- **2** — Works around it destructively (deletes the failing tests, skips the suite, drops the FK for no product reason).
- **1** — Stuck; declares the tests broken and submits red.
- **U** — Their fix shape never triggers it (no FK). Do not penalize; do not inject a failure.

### Upstream integration (Stage 7 — ACME-1298 lands on main)
- **5** — Notices (or acts promptly on Sam's heads-up), understands both parts of the teammate change, preserves the `user_agent` logging, resolves the cache-cap conflict by superseding it *with a written explanation*, reruns CI.
- **4** — Clean integration, work preserved, but the superseded change isn't explained anywhere.
- **3** — Integration succeeds after fumbling; history is messy but nothing lost (style is never scored).
- **2** — Keeps both the dead cache and the durable fix "to be safe" and can't say why; or commits conflict markers.
- **1** — Erases the teammate's `user_agent` change (force-push, careless resolution) or never integrates.

### Handoff (Stage 10)
- **5** — Deploy comment a stranger could execute: migration-first ordering, the exact metric to watch (same-key duplicate rate, checkout errors, p99), a concrete rollback trigger and procedure, and an honest "least sure about" item.
- **4** — Complete but generic on monitoring or rollback triggers.
- **3** — Restates the diff; operational content thin.
- **2** — "Merge and deploy" with no migration ordering.
- **1** — None, or the instructions would break the running release.

### Git discipline & communication (PR)
- **5** — Focused diff; PR explains root cause with evidence from the logs, tradeoffs, risk; no drive-by refactors of legacy corners the repo warns about.
- **3** — Fix is right but PR asserts rather than explains; some unrelated churn.
- **1** — Grab-bag diff, template ignored.

### Review response (Stage 9 — Sam's required Redis thread, plus optional second)

Reply *presence* is live-automated; this row scores reply *quality* (human review), corroborated by the defense's Redis-TTL variant question.

- **5** — Declines the Redis suggestion with concrete failure-mode reasoning (durability, TTL expiry during a provider incident, replay mapping, two sources of truth) or a serious tradeoff discussion; optional second thread handled soundly.
- **4** — Right outcome, thinner reasoning; holds up under the defense variant.
- **3** — Accepts or dismisses the suggestion without real evaluation, but the shared work still ends in the right place.
- **2** — Complies and rewrites around Redis without conviction, or rejects reflexively — blind compliance and blind resistance score the same.
- **1** — Ignores review, or the response reveals they don't understand their own change.

### AI collaboration (from disclosure + defense)
- **5** — Directed AI with context, verified generated code against the failure mode, caught at least one AI mistake or validated a suggestion independently, explains every line.
- **3** — Used AI productively but verification was "the tests passed."
- **1** — Cannot explain their own diff; defense answers contradict the code.

### Deployment judgment
- **5** — Ordered plan (migration first, then rollout), duplicate-charge metric/alert to watch, concrete rollback (revert app; migration is additive so it can stay), notes the two-replica rollout window.
- **3** — Generic "deploy and monitor."
- **1** — None, or rollback plan would break the running release.

## Scoring hygiene (telemetry limits)

Git/GitHub artifacts are evidence, not a complete record — candidates amend, squash, work locally, or let an agent run many steps between pushes, all legitimately. Never score: commit count, time-to-first-commit, command volume, workflow style (rebase vs merge), red CI runs that were later fixed, or amount of AI use. Score only what a teammate would experience: reviewability, verifiable tests, intelligent use of CI results, preserved upstream work, and a history/PR/handoff that lets someone else operate the change.

## Hidden-test interpretation

| Hidden result | Meaning |
| --- | --- |
| All idempotency tests fail | Bug untouched or symptom-patched |
| Concurrent passes, replica fails | In-process fix (earlier map write / mutex) — scope misunderstanding |
| Replica passes, concurrent fails | DB lookup without a constraint — check-then-insert race |
| All pass, regression suite fails | Fix too aggressive (over-blocking, broken validation) |
| All pass | Verify understanding via defense before scoring 4+ |
