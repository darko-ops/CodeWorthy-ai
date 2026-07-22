# Grading Autonomy — what's automated, what's human, and why

A common first question from investors and design partners: *shouldn't the app
just auto-grade? Why does it need people in the loop?*

Short answer: **it already auto-grades everything a machine can *prove*. The
rest is human by deliberate design — not because the technology is missing —
and most of it is on a path to automation that we are intentionally not walking
yet.** This document lays out the progression.

## The principle that decides the line

> Deterministic checks measure **outcomes** ("does the fix survive
> concurrency?"). They cannot measure **understanding** ("can this person
> explain *why*, and would they catch the next one?").

This matters more for CodeWorthy than for any other assessment product, because
of one fact: **an AI agent can produce a passing outcome the candidate cannot
explain.** A genuine engineer and someone who blindly accepted an agent's patch
both turn the hidden suite green. Telling those two apart *is the product.* So
the grading line is drawn exactly there:

- Anything a machine can **prove** from the artifacts → automated, now.
- Anything that requires judging **understanding, ownership, or communication**
  → human now, calibrated-AImaybe-later, but never a black box that issues a
  hiring verdict on its own.

Auto-grading *everything* would collapse the exact distinction CodeWorthy
exists to measure.

## What is automated today (zero humans, deterministic)

Run by `scripts/grade-submission.sh`, producing a machine-checked
`grading-record.json` with no reviewer involved:

| Signal | How | Competencies it grades |
|---|---|---|
| **Red/green baseline check** (`evaluation/baseline-check/`) | Runs the candidate's *tests* against the pristine baseline (must fail) and their branch (must pass) → verdict `genuine-regression-test` / `test-theater` / `broken-on-branch` / `no-test-changes` | Testing (gates the rubric row) |
| **Hidden suite** (`evaluation/hidden-tests*/ --summary`) | Concurrency, cross-replica, auth, flag-guard, "unrelated behavior intact," etc. → per-check pass/fail | Implementation correctness, data safety, systems-under-conditions |
| **Seeded-state / leak / signature guards** (CI) | Keep the scenarios honest so the automated verdicts stay trustworthy | (integrity of the above) |

This is roughly **half the competency profile**, and it is the anti-cheat core:
the baseline check mechanically catches a beautiful fix bolted to a worthless
test. In the product UI these render as **"auto check"** rows that tick live.

## What is human today (and why)

| Signal | Why a machine can't settle it *yet* |
|---|---|
| Root-cause quality | Requires judging whether the *explanation* is correct, not just whether the symptom disappeared |
| Communication (PR narrative, handoff) | Judging teachability and honesty, not presence of text |
| Systems thinking / ownership | Did they find the unreported problem, reason about the pilot customer, flag the unguarded surface? |
| **The defense** | Adaptive questions from *their* diff — the only instrument that separates "understands it" from "an agent produced it." |
| AI collaboration | Scored on control (can they explain and justify every line), observable only by probing |

These render as **"submitted — pending review"** — never as a green auto-check.
The product deliberately refuses to fake auto-verification on judgment rows
(see `mvp-architecture.md`, Principle 2).

## "Proctor" ≠ invigilator

CodeWorthy explicitly rejects surveillance — no webcam, no keystroke scoring, no
"AI-cheating detection" (`concept.md`). The human in the loop is an
**orchestrator + reviewer**, and every job they do has an automation path:

| Human job today | Automation path (roadmap) |
|---|---|
| Provision the candidate repo | ✅ already scripted (`scripts/provision-candidate.sh`) → GitHub App (Phase 3) |
| Play the simulated teammate ("Sam", one review thread) | AI reviewer generated from the diff (Phase 4.1) |
| Run the defense conversation | AI-led adaptive defense (Phase 4.3) |
| Score the judgment competencies | LLM-as-judge *drafts with evidence citations*, human *approves* |
| Watch for confusion / calibrate | Shrinks to spot-checks as data accrues |

## The progression

**Now (validation phase — first ~5–20 candidates).** Human-in-the-loop is the
*point*, not a limitation. You cannot build a trustworthy auto-grader for
"understanding" until you have watched enough real humans to know what strong vs.
weak looks like. Automating the judgment layer before that calibration bakes
shallow assumptions into the evaluator — the specific failure the strategy warns
against. The manual reviews generate the training signal.

**Next (post-validation).** With a corpus of human-graded submissions, an
AI interviewer runs the defense and an LLM-judge **drafts** the judgment scores
against the rubric, each with a cited evidence line. Orchestration (provisioning,
the teammate comment, event tracking) moves to the GitHub App. Deterministic
grading is unchanged — it was always automated.

**At scale.** Everything deterministic auto-grades live; the AI drafts the
judgment half; a human **approves or spot-checks** the final profile. The human
per-assessment cost approaches "review an already-drafted report," not "grade
from scratch."

**What never becomes a pure black box.** The final hiring-relevant profile keeps
a human accountable far longer than is technically necessary, for one reason: a
bad hire traced to an unexplained score is what destroys trust in the signal.
The product's promise is *evidence, not an opaque number* — an autonomous grader
that emits "Communication 3/5" with no inspectable basis is precisely the thing
buyers already distrust. So the end state is **AI-drafts, human-approves, every
rating cites evidence** — not "the app decides."

## The one-sentence version

CodeWorthy auto-grades what it can prove and human-judges what requires
understanding; the judgment layer automates *after* real pilots calibrate it,
and even then it drafts rather than decides — because separating real
understanding from a passing AI-generated patch is the whole product, and only
the defense can do that.
