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
| **Red phase:** candidate pushes a failing test / opens draft PR | Inspect the red run. Confirm the failure is *the seeded bug's signature* (duplicate order created / wrong count), not an environment error. If it's red for the wrong reason (setup mistake), tell them plainly — that's rules, not solution. Record: red achieved, reason correct? |
| **Green-ish phase:** first complete implementation pushed | Wait for their CI to settle. The **recovery failure** normally appears here on its own (see below) — do not point at it. If they ask "is CI broken?", answer only: "CI infrastructure is healthy; the logs are accurate." |
| Implementation + recovery are green | **Land the upstream change** on `main` per `evaluation/upstream-change/README.md`, and post Sam's heads-up comment on their PR. |
| Candidate has integrated upstream, PR is marked ready | Post the **three review comments** (below) as Sam, as one review. |
| Review resolved | Ask for the **handoff comment** if the PR doesn't already contain one: "Before we merge — assume I'm deploying this while you're on vacation. Leave me the runbook comment: what changed, migration order, what to watch, what makes us roll back, what you're least sure about." |
| Handoff posted | Schedule/run the **defense** (`evaluation/defense-questions.md`), then hidden suite + report per `evaluation/grading-workflow.md`. |

## The recovery failure (Stage 6) — what to expect

The canonical DB-backed fix adds a table with a foreign key to `orders`. The test harness (`test/helpers/testDb.ts`) resets with a plain `TRUNCATE order_items, orders`, which Postgres then rejects: `cannot truncate a table referenced in a foreign key constraint`. Their targeted regression test passes while the rest of the suite goes red — in CI and locally.

- This is **intentional**. Do not warn them, do not fix it for them.
- Correct recoveries: `TRUNCATE ... CASCADE`, or adding their table to the truncate list, or resetting it in their own test setup. Any of these is fine.
- What's being scored: reading the error, attributing it correctly ("my schema change broke the harness's assumption" — not "the tests are flaky"), fixing it as part of their change, and ideally mentioning it in the PR.
- If their fix shape has no FK (valid), the tripwire may never fire. Mark Stage 6 **unassessed** — never inject a fake failure to force it.

## The three review comments (Stage 9)

Post as Sam, one review, after upstream integration. Adapt file/line anchors to their actual diff — but keep the substance:

**1. Valid correctness concern** (anchor on their key-claiming code):
> Walk me through the two-replica case: both get the same key, both run your existence check before either has committed. What stops two orders here? Is there a constraint that makes this impossible, or just a window we've made smaller?

*Strong response:* points at the unique constraint / ON CONFLICT and explains the blocking-then-conflict behavior, or — if their fix actually has this hole — acknowledges it and fixes it. *Weak:* "the test passes."

**2. Plausible but inferior suggestion:**
> Could we skip the migration entirely and use Redis with `SET key NX PX 30000` for this? We already run Redis for sessions, and it avoids touching the orders schema.

*Strong response:* declines with reasons (durability across restarts/failover, TTL expiring during a PayFlow incident recreates the bug, key→order mapping needed for replay, two sources of truth) — or engages seriously with when Redis *would* be appropriate. *Weak:* rewrites the fix around Redis because the reviewer said so, or dismisses it with no argument. Blind resistance scores no better than blind compliance.

**3. Maintainability / contract concern** (adapt to their diff — pick whichever applies):
> - If they changed the replay response shape or status: "The Northfield integration parses the full order body on replay per our API docs — this now returns something different. Compatible or not?"
> - If shape is unchanged: "`orderService.createOrder` now mixes key-claiming, checkout, and replay lookup in one method — the next person touching checkout has to understand all three. Worth splitting, or do you want to leave it and why?"

*Strong response:* a compatibility argument grounded in the documented contract, or a scoped judgment call ("splitting now widens the diff; I'd do it in a follow-up because…"). *Weak:* ignores the contract question; or does a large drive-by refactor mid-PR.

Respond to their replies in character, briefly. One round is usually enough; never let review exceed two rounds in a 90-minute assessment.

## Rules for the proctor

- Never answer technical questions as the facilitator; route them to Sam only when a real teammate plausibly would (product behavior: yes; "what's the bug?": no).
- Never mention hidden tests, the tripwire, or the upstream change before their triggers.
- Answer any rules/process question immediately and completely.
- If infrastructure genuinely breaks (Actions outage, provisioning error), stop the clock, say so explicitly, fix it, restart. Infrastructure failures are never the candidate's problem.
- Log timestamps of each stage transition — pacing data feeds calibration, not scoring.
