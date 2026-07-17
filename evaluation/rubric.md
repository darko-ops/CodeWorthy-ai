# Scoring Rubric — ACME-1287 (Duplicate order on checkout retry)

Score each competency 1–5 with cited evidence (diff, tests, PR text, defense answers, hidden-test results). Never collapse to a single number. Mark competencies the candidate ran out of time for as **unassessed**, not 1.

## The seeded bug (reviewer context)

`OrderService` "handles" idempotency with a **per-process in-memory Map that is only written after payment capture completes**. It therefore fails when:

1. a retry arrives while the original request is still in flight (the map isn't written yet) — this is what the ticket's logs show;
2. the retry lands on a different replica (production runs two) or after a restart/deploy;
3. the map is cleared by its crude 5,000-entry cap.

The sequential visible test passes, which is deliberate false confidence. The correct fix moves idempotency into Postgres (e.g. a keyed table written inside the order transaction with a unique constraint, replaying the stored order on conflict). See `evaluation/reference-solution/`.

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
- **5** — New test fails on baseline and passes with fix; covers concurrent same-key retry *and* cross-instance/restart; keeps distinct-key behavior covered.
- **4** — Fails on baseline, covers concurrency **or** cross-instance.
- **3** — Sequential retry test only (already effectively covered — false security).
- **2** — Tests pass trivially / would pass on the buggy code.
- **1** — No meaningful test.

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

### Git discipline & communication (PR)
- **5** — Focused diff; PR explains root cause with evidence from the logs, tradeoffs, risk; no drive-by refactors of legacy corners the repo warns about.
- **3** — Fix is right but PR asserts rather than explains; some unrelated churn.
- **1** — Grab-bag diff, template ignored.

### AI collaboration (from disclosure + defense)
- **5** — Directed AI with context, verified generated code against the failure mode, caught at least one AI mistake or validated a suggestion independently, explains every line.
- **3** — Used AI productively but verification was "the tests passed."
- **1** — Cannot explain their own diff; defense answers contradict the code.

### Deployment judgment
- **5** — Ordered plan (migration first, then rollout), duplicate-charge metric/alert to watch, concrete rollback (revert app; migration is additive so it can stay), notes the two-replica rollout window.
- **3** — Generic "deploy and monitor."
- **1** — None, or rollback plan would break the running release.

## Hidden-test interpretation

| Hidden result | Meaning |
| --- | --- |
| All idempotency tests fail | Bug untouched or symptom-patched |
| Concurrent passes, replica fails | In-process fix (earlier map write / mutex) — scope misunderstanding |
| Replica passes, concurrent fails | DB lookup without a constraint — check-then-insert race |
| All pass, regression suite fails | Fix too aggressive (over-blocking, broken validation) |
| All pass | Verify understanding via defense before scoring 4+ |
