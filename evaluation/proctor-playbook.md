# Proctor Playbook — Running One Candidate Through the Loop

The proctor plays two roles from separate GitHub accounts: **facilitator** (answers process questions, never technical ones) and **teammate** ("Sam", who reviews, merges upstream, and answers product questions in character). In the MVP both are the founder.

The candidate must never be confused about the **rules** — only the solution is theirs to figure out. If a candidate is blocked on process ("where do I push?", "is CI supposed to be red?"), answer immediately and plainly. If blocked on the problem, don't rescue; note it and let the loop continue.

## Provisioning (before the candidate starts)

1. Stamp a private repo from the `simulations/acme-orders` template (that directory only — `evaluation/` never ships).
2. Replace the workflow with `evaluation/candidate-repo/ci.yml` at `.github/workflows/ci.yml`.
3. Open a GitHub Issue titled **"ACME-1287: Duplicate orders when checkout is retried"** with TICKET.md's body — the ambiguity ("Open product question from Northfield") must be in it.
4. Add the candidate as a collaborator; confirm Actions are enabled and a dummy push runs green.
5. Send the invite with ASSESSMENT.md linked and the time expectation restated.

## Timeline of proctor actions

| Trigger | Action |
| --- | --- |
| Candidate asks the Northfield question in the issue | Answer **as Sam, in character**: "Good question — product says return the original order for a same-key retry; integrations treat the key as 'exactly-once from their side.' If you think a 409 is safer for the concurrent case, make the case in the PR." Log that they asked (Stage 2 signal). If they never ask, do nothing — check later whether the PR documents an assumption. |
| **Red phase:** candidate pushes a failing test / opens draft PR | Inspect the red run. Confirm the failure is *the seeded bug's signature* (duplicate order created / wrong count), not an environment error. If it's red for the wrong reason (setup mistake), tell them plainly — that's rules, not solution. Record: red achieved, reason correct? (The definitive fails-on-baseline/passes-on-branch record is produced at grading time by `evaluation/baseline-check/`.) |
| **Green-ish phase:** first complete implementation pushed | Wait for their CI to settle. The **recovery failure** normally appears here on its own (see below) — do not point at it. If they ask "is CI broken?", answer only: "CI infrastructure is healthy; the logs are accurate." |
| Implementation + recovery are green | **Land the upstream change** on `main` per `evaluation/upstream-change/README.md`, and post Sam's heads-up comment on their PR. |
| Candidate has integrated upstream, PR is marked ready | Post the **required review thread** (below) as Sam — plus at most one optional second thread. |
| Review resolved | Ask for the **handoff comment** if the PR doesn't already contain one: "Before we merge — assume I'm deploying this while you're on vacation. Leave me the runbook comment: what changed, migration order, what to watch, what makes us roll back, what you're least sure about." |
| Handoff posted | Schedule/run the **defense** (`evaluation/defense-questions.md`), then hidden suite + report per `evaluation/grading-workflow.md`. |

## The recovery failure (Stage 6) — what to expect

The canonical DB-backed fix adds a table with a foreign key to `orders`. The test harness (`test/helpers/testDb.ts`) resets with a plain `TRUNCATE order_items, orders`, which Postgres then rejects: `cannot truncate a table referenced in a foreign key constraint`. Their targeted regression test passes while the rest of the suite goes red — in CI and locally.

- This is **intentional**. Do not warn them, do not fix it for them.
- Correct recoveries: `TRUNCATE ... CASCADE`, or adding their table to the truncate list, or resetting it in their own test setup. Any of these is fine.
- What's being scored: reading the error, attributing it correctly ("my schema change broke the harness's assumption" — not "the tests are flaky"), fixing it as part of their change, and ideally mentioning it in the PR.
- If their fix shape has no FK (valid), the tripwire may never fire. Mark Stage 6 **unassessed** — never inject a fake failure to force it.

## The review (Stage 9): one required thread, at most two

Keep the simulated reviewer **minimal** (see docs/mvp-architecture.md, Principle 4). Post as Sam after upstream integration. Reply *presence* is a live-automated fact; reply *quality* is scored by you afterward and probed in the defense — the defense, not the review thread, carries the anti-gaming weight (a circulated "right answer" is worthless when the defense asks them to justify it against a variant of the tradeoff).

**Required thread — the tradeoff** (anchor on their key-claiming code):
> Could we skip the migration entirely and use Redis with `SET key NX PX 30000` for this? We already run Redis for sessions, and it avoids touching the orders schema.

This single thread separates pattern-matchers from candidates who reason about failure modes. *Strong response:* declines with reasons (durability across restarts/failover, a TTL expiring during a PayFlow incident recreates the bug, key→order mapping needed for replay, two sources of truth) — or engages seriously with when Redis *would* be appropriate. *Weak:* rewrites the fix around Redis because the reviewer said so, or dismisses it with no argument. Blind resistance scores no better than blind compliance.

**Optional second thread** — post at most one, chosen from their actual diff, only if time allows:

- *Correctness probe* (if their fix looks racy): "Walk me through the two-replica case: both get the same key, both run your existence check before either has committed. What stops two orders here — a constraint, or just a smaller window?"
- *Contract concern* (if they changed the replay response shape/status): "The Northfield integration parses the full order body on replay per our API docs — this now returns something different. Compatible or not?"

Respond to their replies in character, briefly. One round is usually enough; never exceed two rounds in a 90-minute assessment.

## Rules for the proctor

- Never answer technical questions as the facilitator; route them to Sam only when a real teammate plausibly would (product behavior: yes; "what's the bug?": no).
- Never mention hidden tests, the tripwire, or the upstream change before their triggers.
- Answer any rules/process question immediately and completely.
- If infrastructure genuinely breaks (Actions outage, provisioning error), stop the clock, say so explicitly, fix it, restart. Infrastructure failures are never the candidate's problem.
- Log timestamps of each stage transition — pacing data feeds calibration, not scoring.
