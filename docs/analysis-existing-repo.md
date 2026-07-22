# Existing-Repo Analysis — Foundation for a New Scenario

Analysis of the CodeWorthy monorepo as of `c154f93`, focused on what a new
(merge-history) scenario can reuse versus what must be authored fresh. No code
was changed to produce this document.

---

## 1. The ACME order-management application

`simulations/acme-orders/` — TypeScript / Express / Postgres, Node 20+, Vitest +
Supertest, plus a React (Vite) dashboard in `web/`.

### Structure and modules

| Path | Role |
|---|---|
| `src/server.ts` | Entry point: builds the app, listens on `config.port` |
| `src/app.ts` | `createApp()` factory: JSON body parsing → `requestId` middleware → `/health` → routers → central error handler |
| `src/config.ts` | Runtime config: only `PORT` and `DATABASE_URL`, read from plain env vars (no dotenv) |
| `src/db.ts` | Single shared `pg.Pool` (max 10) |
| `src/routes/{orders,customers,products}.ts` | Express routers; orders delegates to the service layer |
| `src/services/orderService.ts` | The modern pattern for business logic — checkout transaction, stock decrement, PayFlow capture, the seeded in-memory idempotency cache (ACME-1104) |
| `src/legacy/queries.ts` | 2023-era data-access helpers; customer/product routes still use them and return **snake_case rows the admin dashboard depends on** (documented landmine) |
| `src/payments/payflow.ts` | Simulated payment client; `PAYMENT_LATENCY_MS` env var controls capture latency |
| `src/middleware/requestId.ts` | Request-ID propagation + request start/finish logging |
| `src/lib/logger.ts` | Structured single-line logger |
| `src/lib/errors.ts` | `AppError` + `badRequest`/`notFound`/`conflict` helpers |

The intentional texture (a "modern" services layer beside a "legacy" corner
with a compatibility landmine, in-repo warnings against drive-by refactors) is
exactly the kind of surface a merge-history scenario needs — **reuse it**.

### Auth: none exists

There is **no authentication or authorization anywhere in the app**. No auth
middleware, no user/session/token concept, no roles, no per-customer access
control (`GET /api/orders?customerId=` returns any customer's orders to anyone).
The word "auth" does not appear in `src/`. For a scenario involving
authorization behavior, the entire auth subsystem — model, middleware, seeding —
must be **authored fresh**, and its absence today means there is no existing
test coverage to accidentally collide with.

### Logging

- `src/lib/logger.ts`: minimal structured logger, single-line
  `timestamp level event key=value…` format; `error`/`warn` to stderr, rest to
  stdout. An in-repo comment (ACME-871) warns not to replace it — a deliberate
  constraint, good for scenario continuity.
- `src/middleware/requestId.ts` logs `request.start` / `request.finish` with
  request id, method, path, status, duration, and the idempotency key; honors
  inbound `x-request-id` and echoes it in the response header.
- Domain events logged: `order.created`, `order.replayed`, `payflow.capture`,
  `request.error`, `server.start`.
- **Logging is silenced in tests**: `write()` returns early when
  `NODE_ENV === "test"` unless `LOG_IN_TESTS=1`. Nothing anywhere asserts on
  log output.
- Note: the existing **upstream-change stage already touches logging** — the
  seeded teammate commit (ACME-1298) adds `user_agent` logging that the
  candidate must preserve, and the rubric's Stage-7 row scores that
  preservation. A new scenario that seeds logging behavior must not collide
  with this element if it reuses the upstream-change machinery.

### Feature flags: none exist

There is **no feature-flag mechanism** — no flag library, no config-driven
toggles, nothing conditional on environment beyond `PAYMENT_LATENCY_MS`
(latency simulation, not a flag) and the logger's test-silencing check. A flag
system for a new scenario must be **authored fresh**.

### Migrations

- Plain SQL files in `db/migrations/`, applied in filename order by
  `npm run migrate` (`scripts/migrate.ts`), tracked in a `schema_migrations`
  table. Three baseline migrations: customers/products, orders/order_items,
  payment_capture_id.
- Documented operational contract: **production runs migrations before the new
  app version deploys**, so migrations must be backwards compatible with the
  previous release. The candidate CI's `migration-upgrade` job enforces the
  upgrade path mechanically (main's migrations + seed, then the branch's on
  top).

**Reuse:** the whole app as the environment — module layout, logger, error
model, migration runner and its migrate-before-deploy contract, the legacy
landmine, PayFlow latency knob. **Author fresh:** any auth model, any feature
-flag mechanism, and any log-assertion infrastructure a new scenario's hidden
tests would need.

---

## 2. Evaluation infrastructure

### `evaluation/baseline-check/` — the red/green verdict engine

`baseline-check.mjs` is the core automated verification (mvp-architecture
Principle 1):

1. Diffs `baseline..branch` for added/changed files under `test/`
   (`--diff-filter=ACMR`; only `*.test.ts` files are run, but **all** changed
   test files — including helpers — are overlaid, since candidate tests may
   depend on harness changes like the CASCADE repair).
2. Creates a detached git worktree at the pristine baseline, overlays only
   those test files (never candidate source), symlinks `node_modules`, creates
   a disposable database, runs the tests — they **must fail**.
3. Runs the same tests in a branch worktree with a second disposable database —
   they **must pass**.
4. Emits a JSON evidence record; exit 0 only for `genuine-regression-test`.

Verdicts: `genuine-regression-test` / `test-theater` / `broken-on-branch` /
`no-test-changes`. The record (with failure messages) is grader-facing; the
candidate surface sees only the verdict.

**Reuse as-is for any scenario**: it is scenario-agnostic — it only assumes
tests live under `test/`, vitest is the runner, and `DATABASE_URL` configures
the database. A merge-history scenario needs no changes here unless the seeded
bug's tests live outside `test/` or need non-DB fixtures.

### `evaluation/hidden-tests/run.sh` — hidden suite + sanitized mode

- Copies `evaluation/hidden-tests/*.hidden.test.ts` into
  `simulations/acme-orders/test/hidden/`, runs `npx vitest run test/hidden`,
  and **deletes the copies on exit** (`trap … EXIT`) — hidden specs exist in
  candidate-reachable paths only for the duration of a grader-controlled run.
- `--summary` mode: runs vitest with the JSON reporter, discards all stdout,
  and pipes results through `summarize.mjs`, which maps test titles (regex
  match) onto **five stable public check ids** —
  `concurrent_same_key_retry`, `cross_replica_dedup`,
  `reused_key_distinct_checkout`, `no_key_checkout`, `unrelated_regression` —
  each with a plain-language label and pass/fail/not-run. No test names,
  assertion text, or stack traces. This is the **only** hidden-suite output
  allowed to reach a candidate-facing surface (Principle 5). Several internal
  tests may roll up into one check (the three regression tests → one id).

### Isolation model

Hidden tests never live in the candidate repo. Candidate repos are stamped
from the simulation directory only, with `evaluation/candidate-repo/ci.yml` as
their workflow (the platform's own workflow is stripped because it would leak
that the hidden suite must fail on baseline). Evaluation runs in a
CodeWorthy-controlled context; candidate branches are treated as untrusted
input (no secrets, hidden specs overlaid only after candidate code is not
executing, environment destroyed afterward).

**Reuse:** `run.sh` structure, the summarize pattern, the isolation flow, the
copy-in/trap-cleanup mechanic. **Author fresh for a new scenario:** the hidden
test files themselves, and a new `CHECKS` table in a summarize step (new
check ids become public contract — name them carefully; the mockups render
them verbatim).

---

## 3. The visible test suite — coverage and, critically, gaps

11 tests across three files (all API-level via Supertest against `createApp()`;
DB migrated automatically; order data truncated between suites):

- `test/orders.test.ts` (7): create order (status/total/capture-id/stock),
  **sequential** same-key idempotent retry (the deliberate false-confidence
  test), empty-items 400, unknown-customer 404, insufficient-stock 409 with
  stock untouched, list by customer (both routes), fetch single order.
- `test/customers.test.ts` (3): create returns legacy snake_case shape,
  missing-email 400, list.
- `test/health.test.ts` (1): `/health` ok.

### What it does NOT cover

- **Authorization: nothing** — there is no auth in the app, so no test
  touches identity, roles, or access control. A new scenario can seed auth
  behavior with a guarantee that the visible suite is silent on it.
- **Logging: nothing** — no test asserts a log line, the `x-request-id`
  response header, request start/finish events, or the error-handler logging
  path. The logger is actively silenced under `NODE_ENV=test`, which means
  log-behavior bugs are structurally invisible to the current suite.
- **Feature flags: nothing** — none exist.
- Also untested: the 500 error-handler branch, `/health` degraded path,
  products routes (no dedicated test file; only indirect use), PayFlow
  latency behavior, and any concurrency (by design — that's the hidden
  suite's job).

**This is the key finding for the new scenario:** auth, logging, and flags are
exactly the blind spots the current visible suite already has — two of them
because the subsystems don't exist. Authoring those subsystems fresh keeps
perfect control over what the visible suite covers; the one place logging
already appears in evaluation machinery is the ACME-1298 upstream `user_agent`
change (see §1), which a new scenario must either reuse deliberately or avoid.

---

## 4. CI configuration

### Platform repo (`.github/workflows/ci.yml`) — three jobs, all on every push/PR

1. **visible-tests** — Postgres 16 service container; `npm ci`,
   `npm run typecheck`, `npm test` in `simulations/acme-orders`.
2. **seeded-bug-reproduces** — runs the full hidden suite against the baseline
   and **inverts the result**: the job fails if the hidden suite *passes*,
   because that would mean someone accidentally fixed the seeded bug and broke
   the assessment. This is the guard a new scenario must replicate for its own
   seeded bug.
3. **web-build** — typecheck + build of the dashboard.

Green = visible suite passes **and** the seeded bug still reproduces **and**
the web app builds. Red = any visible test/typecheck failure, a web build
failure, or — most importantly — the seeded bug no longer reproducing.

### Candidate repo (`evaluation/candidate-repo/ci.yml`) — three jobs

1. **tests** — typecheck + visible suite (source of the candidate's red/green
   phases; runs on every push so the red phase is a visible red run).
2. **migration-upgrade** — checks out `origin/main`'s `db/migrations` +
   `scripts`, migrates + seeds (simulating the running release), then applies
   the branch's migrations on top (simulating the deploy), then `npm run build`
   — validating the upgrade path, not a clean DB.
3. **web** — dashboard typecheck + build.

The seeded-bug-reproduces job is deliberately absent here (it would leak the
answer).

**Reuse:** both workflows as templates; the inversion-guard pattern and
migration-upgrade job are scenario-agnostic. **Author fresh:** a
seeded-bug-reproduces job pointed at the new scenario's hidden suite, and any
additional required checks the new scenario's loop needs (e.g. a job the
merge-history stage is expected to break and the candidate must re-green).

---

## 5. Rubric, defense questions, report template — the scoring model

- **Rubric (`evaluation/rubric.md`)** — 1–5 anchors per competency, written
  against this scenario's specifics (root-cause, implementation, regression
  testing, data safety, systems thinking, plus stage-based rows: requirements
  clarification, CI red phase, recovery tripwire, upstream integration,
  handoff, review response, AI collaboration, deployment judgment). Two hard
  gates: the **baseline-check verdict caps the testing row** (`test-theater`
  → max 2), and **telemetry limits** forbid scoring commit count, timing,
  workflow style, red-then-fixed CI runs, or amount of AI use. Time-outs are
  **U (unassessed), never 1**. A hidden-result interpretation table maps
  pass/fail patterns to failure modes (e.g. concurrent-pass/replica-fail =
  in-process fix).
- **Defense questions (`evaluation/defense-questions.md`)** — five questions
  generated from the candidate's actual artifacts; the **corroboration rule**:
  no un-verifiable artifact (repro command, root-cause note, AI disclosure)
  stands without a defense question generated from it. Adaptive follow-ups are
  keyed to diff shapes (new table, select-then-insert, 409-on-replay, sleeps
  in tests, tripwire hit, upstream integration, the Redis review thread).
  The defense is the anti-gaming layer; it never tries to detect AI use.
- **Report template (`evaluation/report-template.md`)** — outcome summary in
  plain language; automated verification tables (baseline-check verdict +
  sanitized hidden summary); a **workflow-events table** (facts before
  interpretation); then the competency profile where **every rating must cite
  inspectable evidence** — "never a single score" is enforced structurally.
  Candidate-facing copies translate 5–4/3/2–1/U into Strong / Developing /
  Needs work / Not assessed, with evidence lines phrased as facts about the
  work, never judgments about the person. Ends with an explicit
  "what this report does not claim" scope limiter.
- **Grading workflow** — ~45 min/candidate: mechanical checks (visible suite,
  hidden suite full + `--summary`, baseline check) → read the work → defense →
  report, with calibration across batches of five.

**Reuse:** the scoring *model* wholesale — competency framework, U-rule,
telemetry limits, corroboration rule, report structure, label mapping.
**Author fresh:** scenario-specific rubric anchors, the hidden-result
interpretation table, the defense question bank, and the report's
verification-table rows (they enumerate the scenario's check ids verbatim).

---

## Readiness checklist — before authoring a merge-history scenario on this app

- [ ] **Auth subsystem authored** in the app (model, middleware, seed data) —
      none exists today; the scenario's authorization behavior has nothing to
      build on yet.
- [ ] **Feature-flag mechanism authored** — none exists today.
- [ ] **Logging assertions designed** — decide how hidden tests will observe
      log output, because the logger is silenced under `NODE_ENV=test`
      (`LOG_IN_TESTS=1` exists but nothing uses it; hidden tests would need a
      capture approach that candidate-visible tests don't reveal).
- [ ] **Visible suite deliberately silent** on auth/logging/flags — confirmed
      possible: today's suite covers none of them; keep new visible tests to
      happy-path behavior only, mirroring the ACME-1287 false-confidence
      pattern.
- [ ] **Seeded merge history written** — the current template is a
      single-commit bootstrap per candidate repo; a merge-history scenario
      needs an authored multi-branch/multi-author history in the template
      stamping step, plus a decision on how `baseline-check --baseline`
      resolves (it assumes one pristine baseline ref).
- [ ] **No collision with existing seeded elements** — the recovery tripwire
      (TRUNCATE/FK), the ACME-1298 upstream change (`user_agent` logging +
      cache cap), and Sam's Redis review thread are all wired into the rubric,
      playbook, and report; reuse or explicitly retire each.
- [ ] **New public check ids named** and a summarize `CHECKS` table written —
      ids are rendered verbatim in candidate/employer surfaces (stable
      contract).
- [ ] **Platform CI guard added** — a seeded-bug-reproduces job for the new
      scenario's hidden suite, so the new bug can't be silently fixed.
- [ ] **Candidate CI decided** — whether `migration-upgrade` and the existing
      jobs suffice, or the merge-history loop needs an additional required
      check the candidate must keep green through the merge.
- [ ] **Rubric anchors, defense bank, and report rows drafted** for the new
      behaviors, honoring the baseline-check gate, telemetry limits, the
      U-rule, and evidence-per-rating.
