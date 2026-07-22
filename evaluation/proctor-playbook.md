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

Respond to their replies in character, briefly. One round is usually enough; never exceed two rounds within the assessment's timebox.

## Rules for the proctor

- Never answer technical questions as the facilitator; route them to Sam only when a real teammate plausibly would (product behavior: yes; "what's the bug?": no).
- Never mention hidden tests, the tripwire, or the upstream change before their triggers.
- Answer any rules/process question immediately and completely.
- If infrastructure genuinely breaks (Actions outage, provisioning error), stop the clock, say so explicitly, fix it, restart. Infrastructure failures are never the candidate's problem.
- Log timestamps of each stage transition — pacing data feeds calibration, not scoring.

---

# ACME-1490 — The Wrong Merge (scenario-specific notes)

Everything above is written around ACME-1287. This scenario is different in
kind: there is **no live teammate loop, no upstream change, no Redis review
thread, and no harness tripwire** — the drama is entirely in the seeded git
history. Reuse the general "rules vs. solution" principle and the provisioning
discipline; ignore the ACME-1287 stage timeline. Files:
`simulations/wrong-merge/{TICKET,ASSESSMENT}.md`,
`evaluation/rubric-wrong-merge.md`,
`evaluation/defense-questions-wrong-merge.md`,
`evaluation/report-template-wrong-merge.md`.

## Provisioning

1. Stamp the candidate repo from the bundle: `simulations/wrong-merge/stamp.sh
   <dest>` (or `scripts/provision-candidate.sh --scenario wrong-merge` once
   built). This preserves the full multi-parent history — **do not** squash or
   snapshot; the candidate's discovery path is git archaeology.
2. Confirm the stamp invariants printed OK (HEAD at the locked merge commit,
   two parents, breadcrumbs present). If they didn't, the repo is unusable —
   fix before inviting.
3. Place `evaluation/candidate-repo/ci.yml` at `.github/workflows/ci.yml`.
4. Open the Issue with `TICKET.md`'s body. The ticket names **two** of the
   three losses (monitor flatline, cross-tenant leak) and is silent on the flag
   guard — keep it that way.
5. Add the candidate as collaborator; confirm `npm ci && npm test` is green.

## What is seeded (reviewer eyes only — never hint any of this)

The `feature/order-export` merge (`9997d60`) resolved the one conflicted file
(`src/routes/orders.ts`) by taking the incoming side whole, deleting three
main-parent behaviors: the ops-key auth guard (commit `68ec8bc`), the
`order.checkout` log line (`40f6adb`), and the `FLAG_BACKORDERS` backorder path
(`8444911`). Breadcrumbs survive orphaned: `opsKey.ts`, `flags.ts`,
`config.opsApiKey`, `.env.example` entries, and an orphaned `createBackorder`
in `orderService.ts`. Discovery command: `git diff 8444911 9997d60 --
src/routes/orders.ts`.

## Proctor conduct during the assessment

- **Do not point at the third loss.** Finding the flag guard without a ticket
  pointer is the ownership probe (rubric §Ownership). If they ask "is there
  anything else broken?" answer only as a process fact: "the ticket lists what
  ops reported; whether the merge did more than ops noticed is exactly what the
  audit is for."
- **Do not confirm or deny discovery methods.** If they ask "is diffing against
  the parent the right approach?", that's solution, not rules — don't answer.
  If they ask "which commit is the merge?", that's readable from `git log` —
  point them to the history, don't hand them the SHA.
- **The unguarded export route is a stretch finding, not a required fix.** Never
  raise it. If they raise it unprompted, note it (Security/Systems 5 signal) and
  stay neutral.
- **Green CI is intended.** If they're unsettled that everything passes, confirm
  only that "the visible suite is green and the logs are accurate" — the point
  of the scenario is that green didn't catch the loss.

## After submission

Run grading per `evaluation/grading-workflow.md` using the wrong-merge suite
(`evaluation/hidden-tests-wrong-merge/run.sh <repo> [--summary]`) and the
baseline check with `--baseline` = the merge commit `M` (`9997d60`). Then the
defense (`defense-questions-wrong-merge.md`) and the report
(`report-template-wrong-merge.md`). The baseline signature at `M` is
fail/fail/fail/pass/pass — if a candidate's *branch* still shows that, they
changed nothing that the checks observe.
