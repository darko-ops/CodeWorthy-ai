# CodeWorthy — Build Roadmap

How the rest of CodeWorthy gets built, in dependency order, with a ready-to-paste
agent prompt for each work item. Written against the real repo state as of the
timebox-reconciliation commit.

## The one rule that orders everything

**Validate the assessment before you automate it.** The concept doc and
`mvp-architecture.md` are explicit: run the first candidates *manually*, review
every submission by hand, and only then build platform automation. Building the
GitHub App, a backend, or an isolated runner *before* proving the assessment
separates strong from weak engineers would encode shallow assumptions into
expensive infrastructure — the exact mistake the business plan warns against.

So the phases are gated, not parallel:

| Phase | Goal | Unblocks | Build weight |
|---|---|---|---|
| **0 — Run one candidate by hand** | Prove the assessment produces a report a hiring manager trusts | Everything | Small (authoring + scripts) |
| **1 — Thin the sharpest manual edges** | Make running 5–20 candidates bearable | Repeatable pilots | Medium (scripts) |
| **2 — Real backend + API** | Reports and dashboards on real data, not `data.ts` | A sellable product | Large |
| **3 — GitHub App + orchestration** | Live checklist, isolated auto-evaluation | Scale past hand-holding | Large |
| **4 — Scale content + automate judgment** | More scenarios, AI-led defense | Moat | Ongoing |

Do **not** start a phase until the prior one has produced its evidence. Phase 0
is days of work and returns the single most valuable thing the company can have:
proof the core idea works.

## Current state (what these prompts build on)

- **Test engine — built & CI-green:** `simulations/acme-orders` (bug scenario),
  `evaluation/baseline-check` (red/green verifier), `evaluation/hidden-tests`
  (+ `--summary`), and the wrong-merge scenario *engine* (`simulations/wrong-merge`
  bundle + stamp, `evaluation/hidden-tests-wrong-merge` suite + leak guard +
  signature assert). CI guards the seeded state of both.
- **Site — built, demo data only:** `site/` (React/Vite) renders every screen
  from `site/src/data.ts` (static exports; the file's own header says swapping in
  a real API is "a matter of replacing these exports with fetchers"). No backend
  exists.
- **Authoring — one scenario complete, one half:** ACME-1287 has ticket, rubric,
  defense bank, report template, proctor playbook. ACME-1490 (wrong-merge) has
  its engine but **no candidate ticket, rubric anchors, defense bank, report
  tables, or proctor notes** — they exist only inside `docs/scenario-wrong-merge.md`.

## Decisions to make before Phase 2 (flagged, not assumed)

These change what the prompts say; make them when you reach them, not now.

1. **Backend stack & host.** Recommend Node/TypeScript (shares language with
   site + engine) — e.g. Fastify or Hono + Postgres + Prisma, on a
   container host (Fly/Render/Railway). Alternative: a BaaS (Supabase) to skip
   auth/DB plumbing for the pilot.
2. **Auth.** Build-vs-buy. Recommend buy for the MVP (Clerk/Auth0/Supabase
   Auth) — the demo role toggle in `site/src/auth.tsx` is the seam to replace.
3. **Evaluation isolation host.** Where untrusted candidate branches run
   (Phase 1/3). Recommend GitHub Actions in a CodeWorthy-controlled repo (the
   pattern `mvp-architecture.md` Principle 5 already describes) before anything
   custom.
4. **The still-open doc conflict:** the single overall score (`avgRating` exists
   in `data.ts` but no screen renders it). Resolve before the report UI is
   finalized in Phase 2.

---

# Phase 0 — Run one candidate, by hand

Goal: take one real person through ACME-1287 end to end and produce a report,
using only scripts and docs — no new services. Then do it once more with
ACME-1490 after finishing its authoring.

### 0.1 — Finish the wrong-merge scenario's authoring artifacts

The engine is built; the human-facing scenario is not. Everything needed is
already specified in `docs/scenario-wrong-merge.md` — this is transcription into
the same file shapes ACME-1287 uses, not new design.

> **Prompt for a coding agent:**
> Read `docs/scenario-wrong-merge.md` end to end — it is the complete spec for
> the ACME-1490 "wrong merge" scenario. The scenario's *engine* is already built
> under `simulations/wrong-merge/` and `evaluation/hidden-tests-wrong-merge/`.
> What's missing are the human-facing authoring artifacts, which currently exist
> only inside the spec. Create them as standalone files, mirroring exactly how
> the existing ACME-1287 scenario is structured:
> 1. `simulations/wrong-merge/TICKET.md` — the candidate-facing ticket, from
>    spec §2 "The ticket the candidate receives" (verbatim intent). Match the
>    tone and format of `simulations/acme-orders/TICKET.md`.
> 2. `simulations/wrong-merge/ASSESSMENT.md` — mirror
>    `simulations/acme-orders/ASSESSMENT.md`, with this scenario's 2h timebox and
>    its deliverable contract from spec §4. Keep the fairness language
>    (unassessed ≠ failed) identical.
> 3. `evaluation/rubric-wrong-merge.md` — the rubric, from spec §7's competency
>    table and the strong/weak table in §4. Gate the testing row on the
>    baseline-check verdict exactly as `evaluation/rubric.md` does.
> 4. `evaluation/defense-questions-wrong-merge.md` — the defense bank from spec
>    §6, including the corroboration rule from `evaluation/defense-questions.md`.
> 5. Add a wrong-merge section to `evaluation/report-template.md` (or a sibling
>    `report-template-wrong-merge.md`) with the workflow-events table from spec
>    §7 ("found-all-three", "repair strategy", "export preserved", etc.).
> 6. Proctor notes for this scenario — extend `evaluation/proctor-playbook.md`
>    with an ACME-1490 section (what to seed, what NOT to hint, how the three
>    losses map to the ticket's two named symptoms).
> Constraints: author to the spec, do not invent new mechanics; do not touch the
> engine files, the bundle, or CI; check every scenario-spec claim you rely on
> against the actual seeded history in the bundle before writing (stamp it and
> look). Acceptance: a proctor could run ACME-1490 using only these files, the
> way they can run ACME-1287 today. Commit as "Author ACME-1490 candidate-facing
> artifacts (ticket, rubric, defense, report, proctor notes)".

### 0.2 — A provisioning script for one candidate repo

Today provisioning is a manual checklist in the proctor playbook. Make it one
command so a pilot doesn't fat-finger the setup.

> **Prompt for a coding agent:**
> Write `scripts/provision-candidate.sh` that stands up one candidate repository
> for a chosen scenario, using the `gh` CLI (assume it's authenticated). Inputs:
> `--scenario acme-orders|wrong-merge`, `--candidate <github-username>`,
> `--repo-name <name>`. Steps: (1) create a private repo under the CodeWorthy
> org; (2) populate it — for `acme-orders`, from the `simulations/acme-orders`
> directory (that directory ONLY — `evaluation/` must never ship); for
> `wrong-merge`, by pushing the full history from
> `simulations/wrong-merge/scenario.bundle` via `simulations/wrong-merge/stamp.sh`
> (preserve both merge parents); (3) place `evaluation/candidate-repo/ci.yml` at
> `.github/workflows/ci.yml`; (4) open an Issue with the scenario's TICKET.md
> body; (5) add `--candidate` as a collaborator. Print a checklist of what a
> human still does manually (send invite, start the timebox). Constraints:
> idempotent where possible; never copy `evaluation/`, the bundle's platform-only
> files, or any hidden test into the candidate repo; dry-run mode (`--dry-run`)
> that prints commands without executing. Acceptance: running it produces a repo
> a candidate can clone and `npm ci && npm test` green, with no evaluation
> material leaked. Verify by cloning the result into a temp dir and grepping for
> `hidden`, `rubric`, `baseline-check`. Commit as "Add one-command candidate
> provisioning script".

### 0.3 — A one-command "grade a submission" flow

The pieces exist (`baseline-check`, `hidden-tests --summary`); make grading one
documented path so a reviewer isn't stitching commands.

> **Prompt for a coding agent:**
> Write `scripts/grade-submission.sh` that takes `--repo <path-to-candidate-clone>`
> `--scenario <name>` `--branch <candidate-branch>` and runs the full automated
> half of grading, printing a single consolidated JSON blob: (1) the red/green
> baseline-check verdict + record (`evaluation/baseline-check/baseline-check.mjs`);
> (2) the sanitized hidden-suite summary for that scenario (the scenario's
> `run.sh --summary`); (3) which required checks passed/failed. It must NOT
> attempt to score the human-judgment competencies — those stay manual. Output a
> `grading-record.json` a reviewer then uses to fill the report template.
> Constraints: reuse the existing scripts, don't reimplement them; treat the
> candidate repo as untrusted input (no sourcing their files, no running their
> package scripts beyond the sandboxed test invocation the existing tools already
> do); needs a disposable Postgres (document the `DATABASE_URL` expectation).
> Acceptance: on the reference-solution branch it prints verdict
> `genuine-regression-test` and all checks pass; on the untouched baseline it
> prints the seeded fail signature. Commit as "Add one-command submission-grading
> script".

**Phase 0 exit gate (from `docs/validation-plan.md`):** run 5 candidates, hand
them to experienced engineers as reports without your conclusions, and confirm
strong and weak submissions produce visibly different reports. If they don't,
fix the *scenario/rubric*, not the tooling, before touching Phase 1.

---

# Phase 1 — Thin the sharpest manual edges

Only after Phase 0 shows signal. Turn the most painful manual steps into scripts;
still no long-running services.

### 1.1 — Evaluation runner with real untrusted-input isolation

Promote `grade-submission.sh` into the isolated runner `mvp-architecture.md`
Principle 5 specifies — still a script/CI job, not a service.

> **Prompt skeleton (fill host decision #3 first):**
> Build an evaluation runner that takes a candidate repo URL + branch and runs
> the baseline-check and hidden suite in an ephemeral, network-isolated
> environment where the candidate's branch is treated as untrusted: no secrets in
> scope, hidden tests checked out only AFTER candidate code stops executing, and
> ONLY the structured `--summary` JSON leaving the environment (never test source
> or stack traces). Target: a GitHub Actions workflow in a private
> CodeWorthy-controlled repo, triggered manually with the candidate ref as input.
> Reuse the existing suites verbatim. Acceptance: a candidate branch that tries
> to read the hidden tests off disk or exfiltrate them cannot; the only artifact
> is the sanitized summary. Add a CI test proving the isolation (a malicious
> branch fixture that attempts a read and fails to surface anything).

### 1.2 — Report compiler: grading record → site data shape

Make a real graded result renderable by the existing site.

> **Prompt for a coding agent:**
> Write `scripts/compile-report.mjs` that takes a `grading-record.json` (from
> `scripts/grade-submission.sh`) plus a reviewer's competency ratings + evidence
> lines (a simple YAML/JSON the reviewer fills) and emits an object matching the
> exact TypeScript types the site already uses in `site/src/data.ts` (Candidate,
> ratings, verification checks, baselineVerdict). Read `site/src/data.ts` to
> match the shapes precisely — do not invent fields. Output both the object and a
> candidate-facing and employer-facing markdown rendering (developmental labels:
> 5–4 Strong, 3 Developing, 2–1 Needs work, U Not assessed). Constraints: every
> rating must carry an evidence string or be marked U; never emit the single
> average score unless decision #4 says to. Acceptance: the emitted object drops
> into `data.ts` and renders on the candidate report screen with no type errors.
> Commit as "Add report compiler from grading record to site data shape".

---

# Phase 2 — Real backend + API

Replace `data.ts` static exports with a real persistence layer + API. Large;
make decisions #1, #2, #4 first.

### 2.1 — Data model + API

> **Prompt skeleton (fill stack decision #1 first):**
> Stand up a `server/` service in [chosen stack] with Postgres. Model the domain
> the site already implies (read `site/src/data.ts` and every page under
> `site/src/pages/` for the exact shapes): Org, User (roles: examinee, reviewer,
> owner, viewer), Scenario, Assessment/Invite, Submission, VerificationResult
> (baseline verdict + hidden checks), CompetencyRating (with evidence + the U
> state), Report (draft/released), ShareLink. Expose a REST/RPC API covering
> exactly the reads the site does today and the writes the reviewer flow needs
> (invite, record verification, save ratings, release report). Constraints:
> mirror the existing TypeScript types so the frontend swap in 2.3 is mechanical;
> enforce the review policy from the Settings screen (blind first pass, two-
> reviewer release) at the API layer, not just UI; never expose hidden-test
> internals through any endpoint (only sanitized summaries). Acceptance:
> every screen's data can be served from the API; a seed script reproduces the
> current demo data. Ship with API tests.

### 2.2 — Swap the frontend onto the API

> **Prompt for a coding agent (after 2.1):**
> Replace the static exports in `site/src/data.ts` with fetchers against the new
> API, keeping the exported function/type surface identical so pages don't change
> (the file was designed for this — its header says so). Add loading/error
> states to the pages that now do real I/O. Replace the demo role toggle in
> `site/src/auth.tsx` with real auth ([decision #2]). Constraints: no page
> component rewrites beyond wiring loading/error; keep the check-id and verdict
> vocabulary byte-identical to the engine's `summarize.mjs`. Acceptance: the app
> runs against a live API with real login; demo mode still works via the seed.

---

# Phase 3 — GitHub App + orchestration

Now automate what was manual provisioning + event-tracking. Only worth it once
pilots prove demand and the manual flow is well understood.

### 3.1 — GitHub App for provisioning + events

> **Prompt skeleton:**
> Build the CodeWorthy GitHub App: programmatic candidate-repo creation (from
> template/bundle, scoped installation token per repo), issue + PR-template
> placement, and a webhook receiver. On webhook events, flip the
> *live-automated* checklist rows defined in `mvp-architecture.md` (branch
> pushed, PR opened, required checks green, upstream integrated) — never the
> *submitted-pending-review* rows. Trigger the Phase-1.1 evaluation runner when a
> PR is marked ready. Constraints: scoped tokens (one repo each), candidates can
> never reach the hidden-test repo or another candidate's repo; the webhook only
> updates presence facts, never assigns judgment ratings. Acceptance: an invite
> from the dashboard provisions a repo end to end with no human git commands, and
> the candidate's pushes tick the live rows in real time.

### 3.2 — Evaluation service

Promote the Phase-1.1 runner to a service triggered by 3.1, returning sanitized
summaries into the report pipeline. Same isolation contract; now event-driven.

---

# Phase 4 — Scale content + automate judgment

### 4.1 — Third scenario: reviewer-side (from `docs/behavior-catalog.md`)

The catalog names this the top backlog item — the candidate *reviews* a
plausible-but-flawed PR (an AI-generated fix with a subtle hole), leaves
actionable comments, and handles disagreeing reviewers. Nearly AI-proof because
every step is about other people's work.

> **Prompt skeleton:**
> Spec and build a reviewer-side scenario mirroring the structure of
> `docs/scenario-wrong-merge.md`: a seeded PR with a subtle correctness hole, a
> hidden suite that scores the quality of the candidate's *review* (did they
> catch the hole, were comments actionable, did they resolve conflicting reviewer
> feedback), and the same engine conventions (bundle + stamp, sanitized summary,
> CI seeded-state guard). Author the full artifact set from the start (ticket,
> rubric, defense, report, proctor notes) — don't split engine from authoring
> the way ACME-1490 was.

### 4.2 — Authoring toolkit

Once three scenarios exist, extract the repeated structure (bundle/stamp,
hidden-suite + summarize + signature-assert + leak-guard skeleton, CI job
template, artifact scaffolding) into a generator so scenario #4+ is cheap.

### 4.3 — AI-led adaptive defense

Replace the founder-led defense with an AI interviewer that generates questions
from the candidate's actual diff/tests/PR (the corroboration rule already
governs this). Build only after enough human-run defenses exist to calibrate it.

---

## How to use this document

- Each item's prompt is written for a coding agent (Cursor / Claude Code). They
  drop nuance under pressure, so every prompt names the files, states the
  constraints, and gives an acceptance check — keep that discipline when you
  edit them.
- Work strictly top-down within a phase; respect the phase gates.
- After each item, re-run CI — the seeded-state guards are the tripwire that
  catches an agent "helpfully" fixing a planted bug.
- The near-term critical path to revenue is short: **0.1 → 0.2 → 0.3 → run 5
  candidates.** Everything after Phase 0 is scale, not proof.
