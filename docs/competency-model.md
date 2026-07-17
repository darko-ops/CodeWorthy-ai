# The CodeWorthy Competency Model

Production readiness is not one number. Every simulation is scored against the same twelve competencies, and every rating must cite observable evidence from the candidate's work (diff, tests, terminal activity, written reasoning, defense answers).

Competencies are the *ratings*; the concrete scenarios that produce evidence for them live in the [behavior catalog](behavior-catalog.md), grouped by engineering behavior and tiered by where the signal survives AI assistance (collaboration, git safety, emergencies, and ownership differentiate; mechanical implementation and test-running are table stakes that get verified cheaply).

## Core competencies

| Competency             | What is being measured                                              |
| ---------------------- | ------------------------------------------------------------------- |
| Codebase comprehension | Can the candidate locate relevant systems and trace behavior?       |
| Root-cause analysis    | Do they understand the cause rather than patching the symptom?      |
| Implementation         | Is the change correct, focused, maintainable, and consistent?       |
| Testing                | Do the tests reproduce the failure and protect against regression?  |
| Systems thinking       | Do they understand downstream effects and boundary conditions?      |
| Security               | Do they identify trust boundaries and unsafe behavior?              |
| Data safety            | Are migrations and persistence changes backwards compatible?        |
| Git discipline         | Are commits and pull requests focused and understandable?           |
| AI collaboration       | Do they guide, inspect, and verify AI-generated work?               |
| Communication          | Can they explain the problem, tradeoffs, risk, and solution?        |
| Deployment judgment    | Do they have a safe release and rollback strategy?                  |
| Ownership              | Do they take responsibility for the entire result?                  |

## Rating scale

Each competency is rated 1–5 with written evidence. Anchors:

- **1 — Absent.** No evidence of the behavior, or evidence of its opposite.
- **2 — Fragile.** Attempted, but breaks under mild pressure (e.g. accepted AI output they cannot explain).
- **3 — Functional.** Sound for the visible case; misses non-obvious conditions (e.g. tests sequential retries but not concurrency).
- **4 — Solid.** Correct under the hidden conditions; explains the why, not just the what.
- **5 — Exemplary.** Anticipates conditions we didn't ask about; teaches the reviewer something.

## Reporting rules

1. Produce a **competency profile**, never a single score.
2. Every rating cites specific evidence an employer can inspect.
3. Distinguish "did not finish" from "does not understand" — timeboxed gaps are noted as unassessed, not failed.
4. AI usage is scored on *control* (guide, inspect, verify), never on *whether* AI was used.
5. Claims stay narrow until scores are validated against later job performance (with consent).

## Example profile (duplicate-order assessment)

| Area               | Rating | Evidence                                                                        |
| ------------------ | -----: | ------------------------------------------------------------------------------- |
| Investigation      |    4/5 | Reproduced retries and traced the payment lifecycle                             |
| Implementation     |    4/5 | Added database-backed idempotency correctly                                     |
| Regression testing |    3/5 | Covered sequential retries but not concurrency                                  |
| AI verification    |    2/5 | Accepted a generated transaction helper without understanding failure behavior  |
| Deployment safety  |    4/5 | Proposed a staged release with duplicate-charge monitoring                      |
| Communication      |    5/5 | Clearly explained the failure and rejected alternatives                         |

## Progression ladder (Learn product)

| Level            | Simulated responsibility                      |
| ---------------- | --------------------------------------------- |
| Contributor      | Small, isolated bug fixes                     |
| Maintainer       | Features spanning multiple modules            |
| Owner            | Database and architectural changes            |
| Release engineer | CI, deployment, and rollback                  |
| On-call engineer | Incidents and production recovery             |
| Lead             | Reviewing, planning, and coordinating changes |

Learners advance by demonstrating a competency repeatedly under different conditions — never by consuming content.
