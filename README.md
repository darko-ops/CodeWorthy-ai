# CodeWorthy

**A production-readiness platform for AI-native developers.**

Developers today can build and deploy applications quickly with AI tools. What they often can't prove is that an engineering team can trust them with production access: entering an unfamiliar codebase, investigating before changing, testing what matters, and shipping safely.

CodeWorthy is a production simulation and evaluation engine with two applications:

- **Learn** — developers practice production engineering inside realistic inherited codebases.
- **Assess** — employers see how candidates investigate, test, communicate, and ship (with AI tools allowed) before granting production access.

> **Learn — and prove — that you can ship code a team can trust.**

See [docs/concept.md](docs/concept.md) for the full product thesis, [docs/behavior-catalog.md](docs/behavior-catalog.md) for the behaviors and scenarios we measure (and current coverage), [docs/competency-model.md](docs/competency-model.md) for the rating model, [docs/assessment-loop.md](docs/assessment-loop.md) for the workflow every candidate is tested on, [docs/mvp-architecture.md](docs/mvp-architecture.md) for how the platform delivers and verifies it, [docs/grading-autonomy.md](docs/grading-autonomy.md) for what auto-grades vs. what stays human (and why), [docs/validation-plan.md](docs/validation-plan.md) for the 30-day validation plan, and [docs/build-roadmap.md](docs/build-roadmap.md) for the phased plan (with agent prompts) to build the rest.

## This repository

This repo contains the **MVP: one great assessment**, plus the evaluation machinery around it.

```
.
├── docs/                        Product thesis, competency model, validation plan
├── simulations/
│   └── acme-orders/             The MVP simulation: a B2B order-management app
│       ├── ASSESSMENT.md        Candidate-facing assessment brief
│       ├── TICKET.md            The bug ticket (with production logs)
│       └── ...                  A working TypeScript/Node/Postgres app + React dashboard
├── evaluation/                  PRIVATE in real assessments — never shipped to candidates
│   ├── baseline-check/          Red/green baseline check — the core automated verification
│   ├── hidden-tests/            Hidden conditions the candidate's fix must survive (+ candidate-safe summary)
│   ├── reference-solution/      Maintainer notes + verified reference fix
│   ├── upstream-change/         The teammate commit that lands on main mid-assessment
│   ├── candidate-repo/          CI workflow stamped into candidate repositories
│   ├── proctor-playbook.md      Running one candidate through the loop
│   ├── rubric.md                Scoring rubric mapped to the competency model
│   ├── defense-questions.md     Technical defense question bank + corroboration rule
│   ├── report-template.md       Employer-facing competency report
│   └── grading-workflow.md      How reviewers grade a submission end to end
└── .github/
    ├── workflows/ci.yml         CI: visible tests must pass, seeded bug must reproduce
    └── pull_request_template.md The PR structure candidates fill in
```

### How an assessment works

1. The candidate receives a copy of `simulations/acme-orders/` **only** (as a template repository). The `evaluation/` directory stays private.
2. They read [TICKET.md](simulations/acme-orders/TICKET.md): customers occasionally receive duplicate orders — and duplicate charges — when a checkout request is retried.
3. They investigate, reproduce, fix, add regression coverage, and open a PR using the [PR template](.github/pull_request_template.md). Any AI tools they normally use are allowed.
4. The hidden tests in `evaluation/hidden-tests/` are run against their branch: concurrency, replica/restart behavior, reused idempotency keys, and unrelated-regression checks.
5. An AI-led technical defense generates questions from their actual diff, tests, and written reasoning ([question bank](evaluation/defense-questions.md)).
6. A reviewer produces an evidence-backed competency report ([template](evaluation/report-template.md)) — never a single opaque score.

### Working on the simulation

```bash
cd simulations/acme-orders
npm install
docker compose up -d db        # or point DATABASE_URL at any Postgres 14+
npm run migrate && npm run seed
npm run dev                    # API on :3000
npm test                       # visible test suite
```

Hidden tests (maintainers only):

```bash
evaluation/hidden-tests/run.sh   # copies hidden specs into the simulation and runs them
```

On the unmodified baseline, the visible suite passes and the hidden idempotency suite **fails** — CI enforces both, so we never accidentally "fix" the seeded bug.

## Status

Early. The current milestone is Week 1 of the [validation plan](docs/validation-plan.md): one polished assessment, run manually with five learners, graded by hand.
