# The Behavior Catalog — what CodeWorthy measures

Scenarios are grouped by the **engineering behaviors being measured**. The repo is just the environment. The scenarios are the observations.

This is the master list the simulation library grows against. Each group answers one question an engineering manager actually has. Coverage legend for the current MVP simulation (Acme Orders / ACME-1287):

- ✅ exercised and scored today
- ◐ partially exercised, or observed but deliberately unscored
- ○ backlog — needs a future scenario

## Where the signal lives in the AI era

AI compresses the mechanical middle of engineering. An agent will write the code, run the tests, and usually do it effectively. That doesn't make those behaviors worthless to check — it makes them **table stakes**: necessary to verify (is the human in control of the result?), but no longer where candidates separate.

The signal concentrates in scenarios AI cannot absorb, because they involve **shared state, other people, and irreversible stakes**:

| Tier | Groups | Why the signal survives AI |
|---|---|---|
| **Differentiators** | Collaboration · Git & repo management · Team emergencies · Ownership · Communication · Pull requests | Shared mutable state (someone else's work is in the repo), negotiation with humans, judgment under pressure. An agent can propose a rebase; it can't own what happens to a teammate's commits. |
| **Judgment amplifiers** | Production thinking · Debugging · CI/CD · AI usage | AI assists but the failure modes are exactly where it's weakest: distinguishing environment from code, backwards compatibility, knowing what *not* to trust. |
| **Table stakes** | Ticket execution · Testing | AI does much of the typing. We still verify mechanically (the red/green baseline check) — but as *control verification*, not as the differentiating signal. |

Scoring weight follows the tiers. The current MVP already leans this way — the red/green check verifies testing cheaply so human review time goes to the collaboration and judgment evidence.

## 1. Git & Repository Management

*Can this person safely work in a shared codebase?*

| Scenario | Coverage |
|---|---|
| Clone and bootstrap the project | ✅ orient stage |
| Create a feature branch | ✅ |
| Keep branch up-to-date with main | ✅ upstream change lands mid-PR |
| Resolve merge conflicts | ✅ cache-cap conflict, by design |
| Rebase vs merge decision | ◐ observed, style never scored |
| Recover from a bad merge | ○ |
| Cherry-pick the correct commit | ○ |
| Squash/fixup commits before merge | ◐ observed, unscored per telemetry rules |
| Recover from accidentally deleting work | ○ |
| Understand detached HEAD state | ○ |

## 2. Ticket Execution

*Can they translate ambiguous work into working software?*

| Scenario | Coverage |
|---|---|
| Implement a straightforward feature | ○ (MVP is a bug ticket) |
| Fix a production bug | ✅ ACME-1287 |
| Finish someone else's incomplete ticket | ○ |
| Continue abandoned work | ○ |
| Ticket references another ticket | ◐ ACME-1104/1298 lineage must be understood |
| Requirements intentionally ambiguous | ✅ the Northfield replay-vs-conflict question |
| Ticket missing acceptance criteria | ◐ |
| Multiple possible implementations | ✅ Redis vs DB constraint; 200 vs 409 |

## 3. Testing

*Can they prove their code works?*

| Scenario | Coverage |
|---|---|
| Existing tests fail | ✅ the harness tripwire |
| Missing unit tests | ○ |
| Broken integration test | ○ |
| Flaky test | ○ (deliberately excluded from MVP — intentional flakiness is a bad failure; a *diagnose the flake* scenario is fine later) |
| Snapshot update | ○ |
| Add regression test | ✅ the red/green baseline check — mechanically verified |
| Debug failing CI | ✅ recovery phase |
| Coverage requirement | ○ (and never as a bare percentage — coverage numbers prove little) |

## 4. Pull Requests

*Can they communicate their work?*

| Scenario | Coverage |
|---|---|
| Write a quality PR description | ✅ template-forced, human-scored |
| Explain implementation decisions | ✅ |
| Link related issue | ◐ |
| Request reviewers | ○ |
| Address review comments | ✅ Sam's required thread |
| Push follow-up commits | ✅ |
| Know when to squash | ◐ observed, unscored |
| Respond professionally to criticism | ✅ |

## 5. Collaboration

*Can they function on a real engineering team?* **This is the biggest differentiator.**

| Scenario | Coverage |
|---|---|
| Teammate changed the same file | ✅ upstream change |
| Upstream API changed | ○ |
| Another PR merged first | ✅ |
| Conflicting implementation styles | ◐ legacy-vs-service split in the repo |
| Clarify requirements with PM | ✅ Northfield question, answered in character |
| Ask the right questions | ✅ scored on recognition, not question-asking |
| Continue another engineer's branch | ○ |
| Review someone else's PR | ○ **top backlog item** |
| Leave actionable review comments | ○ |
| Resolve conflicting feedback from two reviewers | ○ |

## 6. CI/CD

*Can they diagnose failures instead of guessing?*

| Scenario | Coverage |
|---|---|
| CI passes locally but fails remotely | ◐ possible via upgrade-path job, not seeded |
| Linter failure | ○ (no linter in MVP stack yet) |
| Type error in pipeline | ✅ typecheck job |
| Migration failed | ✅ upgrade-path job (main's schema → branch's) |
| Missing environment variable | ○ |
| Broken build | ✅ build + dashboard jobs |
| Deployment rollback | ◐ written plan only (by design, MVP) |
| Release blocked | ○ |

## 7. Production Thinking

*Judgment AI struggles with.*

| Scenario | Coverage |
|---|---|
| Backwards compatibility | ✅ migrate-before-deploy constraint, scored |
| Database migration | ✅ |
| Feature flag rollout | ○ |
| Error handling | ◐ |
| Logging | ◐ the log-format landmine (ACME-871) |
| Performance regression | ○ |
| Security issue | ○ (separate scenario track) |
| Edge case discovered after implementation | ✅ concurrency beyond the visible tests |

## 8. Debugging

*Instead of writing code — find what's wrong.*

| Scenario | Coverage |
|---|---|
| Race condition | ✅ **the seeded bug is one** (write-after-completion window) |
| Caching issue | ✅ **and it's also this** (per-process cache as source of truth) |
| Memory leak | ○ |
| Infinite loop | ○ |
| Incorrect API usage | ○ |
| Hidden null pointer | ○ |
| Off-by-one bug | ○ |
| Timezone bug | ○ |

## 9. Ownership

*Where senior engineers separate themselves.*

| Scenario | Coverage |
|---|---|
| Decide between two architectures | ✅ Redis vs DB constraint |
| Explain tradeoffs | ✅ review + defense |
| Reject a poor solution | ✅ the required Sam thread |
| Push back on ticket requirements | ◐ |
| Recommend a simpler implementation | ◐ |
| Recognize technical debt | ◐ superseding the obsolete cache-cap change |
| Document assumptions | ✅ PR template + Northfield decision |

## 10. Team Emergencies

*These feel like actual work.* **Least covered group — richest source for the next simulation.**

| Scenario | Coverage |
|---|---|
| Main branch suddenly breaks | ○ |
| Hotfix required | ○ |
| Security vulnerability discovered | ○ |
| Dependency update breaks project | ○ |
| Production outage simulation | ○ (separate incident track) |
| Revert bad deployment | ◐ written rollback plan only |
| Recover accidentally deleted file | ○ |
| Fix merge after teammate force-pushed | ○ |

## 11. Communication

*Almost never tested today.*

| Scenario | Coverage |
|---|---|
| Write a bug report | ○ |
| Explain a technical decision | ✅ |
| Summarize investigation | ✅ root-cause section |
| Ask for clarification | ✅ |
| Update ticket status | ◐ |
| Write release notes | ○ |
| Explain failure to reviewer | ✅ handoff + review thread |

## 12. AI Usage

*Never score whether they use AI. Score how they work with it.*

| Scenario | Coverage |
|---|---|
| Verify AI-generated code | ✅ defense corroboration |
| Catch hallucinated APIs | ◐ emerges naturally, not seeded |
| Reject incorrect suggestions | ◐ Sam's Redis thread is a proxy |
| Adapt generated code to project conventions | ✅ legacy-layer landmines |
| Explain generated implementation | ✅ defense |
| Add missing tests AI forgot | ◐ hidden suite exposes gaps |

## What the next simulation should add

Reading the ○ marks against the tiers, the highest-value uncovered scenarios are all in the differentiator groups:

1. **Review someone else's PR** (Collaboration) — flip the current loop: the candidate is the reviewer of a plausible-but-flawed PR (an AI-generated fix with a subtle hole works perfectly here). Tests reading code they didn't write, leaving actionable comments, and rejecting politely.
2. **Team emergency: broken main + hotfix** (Emergencies) — main breaks while their PR is open; ship a hotfix, rebase their work over it, keep both alive.
3. **Conflicting feedback from two reviewers** (Collaboration) — Sam and a second reviewer disagree; the candidate must resolve, not just comply with whoever spoke last.
4. **Continue another engineer's branch** (Collaboration/Ticket execution) — inherit a half-finished branch with a misleading commit message.

A second scenario built from 1–3 would be nearly all Tier-1 signal — and nearly AI-proof, because every step is about other people's work, not code generation.

## The long-term vision: a full sprint

Instead of "LeetCode for coding," CodeWorthy is a **flight simulator for software engineering**. A candidate isn't solving isolated problems — they're living through an engineering sprint:

1. Join an existing repository.
2. Pick up tickets.
3. Write code.
4. Collaborate with teammates.
5. Survive unexpected changes.
6. Open PRs.
7. Handle review.
8. Fix CI.
9. Merge safely.
10. Ship.

By the end, the question answered isn't "can they code?" It's:

> **Would you trust them with commit access to your production repository on Monday morning?**

That is a much stronger hiring signal than solving a binary tree problem in 30 minutes. Individual behavior groups above are the units of measurement; the sprint is the delivery vehicle that strings them into one continuous, realistic week.
