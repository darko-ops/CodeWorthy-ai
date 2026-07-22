# CodeWorthy — Product Concept

## The core idea

A platform that teaches developers how to work safely inside a professional engineering team — and lets employers test whether candidates can actually do it.

The user doesn't solve isolated algorithms or follow a tutorial. They enter an unfamiliar, realistic codebase and complete production-style work: diagnose a bug, understand existing architecture, make a focused change, write meaningful tests, work through CI failures, handle database migrations, open and defend a pull request, deploy to staging, verify the release, respond to an incident, roll back safely.

They can use Claude, Codex, Cursor, documentation, and search. The platform measures whether they can use those tools responsibly and still understand, verify, and take ownership of the result.

The central promise:

> **Learn — and prove — that you can ship code a team can trust.**

## The problem

**For developers.** AI has created a new class of capable builders who can build applications from scratch, generate significant amounts of code, and deploy personal projects — but who have never learned to work inside someone else's architecture, investigate before changing code, write tests that catch real regressions, keep pull requests focused, review AI-generated code critically, or safely deploy into a live system. They can demonstrate a portfolio, but they struggle to prove that a team can trust them with production access. Traditional tutorials teach construction; they rarely teach stewardship.

**For employers.** A portfolio no longer proves the candidate personally understands the code. LeetCode-style questions measure algorithm practice more than day-to-day engineering. Take-homes can become unpaid product work and are easy to outsource to AI. Employers need to know: *if we put this person inside our codebase with AI tools, will they make the team faster — or create hidden risk?*

## Product thesis

One **production simulation and evaluation engine** with three applications:

| Product | Customer              | Purpose                                    |
| ------- | --------------------- | ------------------------------------------ |
| Learn   | Individual developer  | Develop production engineering skills      |
| Assess  | Employer              | Measure those skills during hiring         |
| Onboard | Employer and new hire | Prepare someone for a real team and stack  |

The same competency model powers all three. Learning builds the talent pool; hiring monetizes access to verified talent; onboarding creates recurring enterprise value after a hire.

## Who it serves first

**Learner:** not a complete beginner. Someone who has built and deployed at least one application, uses AI coding tools heavily, can write or modify TypeScript, and wants their first serious software job. The bridge from "I can build an app" to "I can be trusted to contribute to your app."

**Employer:** a startup with ~10–100 engineers that hires full-stack or backend engineers, receives many AI-assisted applications, dislikes LeetCode, cannot spend six engineer-hours per candidate, and is willing to let candidates use AI at work.

## The simulation environment

Every challenge begins with a working but imperfect application: a realistic repository, existing architecture and conventions, product documentation, an issue tracker, commit history, seeded database, automated tests, CI pipeline, staging environment, logs and monitoring, hidden evaluation tests, AI reviewers, and one production-style assignment.

The repository should feel like a codebase someone has maintained for three years — inconsistent but plausible naming, old abstractions, partial test coverage, misleading symptoms, realistic documentation gaps, conventions that must be discovered, and areas that should deliberately not be touched. The question is not "can they produce working code" but "can they operate under constraints."

## Evaluating AI usage

Do **not** prohibit AI. Candidates may use Cursor, Codex, Claude Code, ChatGPT, docs, and search — that is the job they're being hired to do. The product does not ask *did the candidate use AI?* It asks *did the candidate remain in control of the work?*

Responsible AI use looks like: providing sufficient context, breaking work into steps, reviewing generated diffs, running tests instead of trusting assertions, rejecting unnecessary refactors, detecting hallucinated APIs, being able to explain generated code, and remaining accountable for the result.

After submission, an **AI defense** asks adaptive questions generated from the candidate's actual diff, tests, terminal history, and written reasoning — testing understanding without pretending to detect "AI cheating."

## Candidate experience and fairness

Rules: every assessment declares its timebox up front, matched to scenario complexity (standardized scenarios stay short enough to be a screen, not a take-home); tell candidates exactly what is evaluated; let them use their normal tools; never ask them to build a real company feature for free; give candidates their competency report; distinguish "did not finish" from "does not understand."

Never: webcam surveillance, keystroke suspicion scores, unreliable AI-cheating detection, personality analysis from coding behavior, or one opaque pass/fail number. Evaluate observable engineering work only.

## Differentiation

| Existing approach           | CodeWorthy                                            |
| --------------------------- | ----------------------------------------------------- |
| Build a system from scratch | Safely modify an existing system                      |
| Solve a programming problem | Complete a production workflow                        |
| Test final code             | Evaluate investigation through deployment             |
| Ban or constrain AI         | Allow AI and measure responsible use                  |
| Generic coding score        | Evidence-backed production competency profile         |
| Candidate assessment only   | Learning, assessment, and onboarding share one engine |
| Clean exercise repository   | Realistic inherited codebase                          |
| "Can they code?"            | "Can a team trust them?"                              |

The most defensible conceptual difference is **brownfield engineering**: entering an existing system, understanding constraints, and making safe changes. That is closer to most engineering jobs than building a clean app from scratch.

## Business model (initial)

Sell manually to startups: **five candidate assessments for $1,000**, including reports and founder-led review. Learn from watching employers interpret five reports before designing SaaS pricing. Individual learning ($29–49/mo practice, $99–199 structured program, $250–500 reviewed capstone + verified profile) and per-seat onboarding come later.

## What the company really is

At the surface this looks like a coding education or technical assessment company. The deeper idea is a **trust layer for AI-assisted software engineering**. AI makes code production abundant; the scarce thing is confidence that a person understands the system, recognizes risk, verifies generated work, can explain their decisions, and can be trusted with production responsibility.

Teach the behaviors teams trust. Measure those same behaviors during hiring. Reinforce them during onboarding.

The best first move is not building the whole platform. It is creating one assessment realistic enough that an experienced engineering manager says: *"This tells me more about the candidate than our current technical screen."*

## Risks (and mitigations)

- **Assessment validity** — keep claims narrow; show evidence, not conclusions; compare scores with structured human review; recalibrate rubrics continuously.
- **Simulation realism** — senior engineers author scenarios from recurring failure patterns; include realistic ambiguity.
- **Content cost** — one language/stack first; parameterize bugs; build authoring tools only after several manual scenarios.
- **Employer sales cycles** — enter as an optional technical screen for startups; human-reviewed pilots.
- **Candidate burden** — short standardized assessments; candidates keep their results; one verified attempt is reusable.
- **Gaming** — scenario variants, adaptive hidden tests, defense questions generated per submission; score reasoning and verification, not just the patch.

## Brand

- Category: **production-readiness platform**
- One-liner: *A simulation platform where developers learn — and prove — they can safely contribute to real software teams.*
- Shortest expression: **a flight simulator for software engineers.**
- Avoid "vibe coders" in public positioning; use "production engineering for AI-native developers."
