# Scenario Spec — "The Wrong Merge Resolution" (ACME-1490)

**Rung:** Maintainer/Owner · **Substrate:** `simulations/acme-orders` ·
**Status:** design spec (build target; no code authored yet)

The premise: a prior developer merged a feature branch and resolved the merge
conflict in one file by taking the incoming side wholesale ("Accept Incoming
Change" for the entire file). CI stayed green. The merge silently deleted three
behaviors that existed only on the other parent: an authorization check, a set
of structured logging fields, and a feature-flag guard. The feature works. The
candidate must audit the merge, determine what was lost, restore it **without
losing the feature**, add tests that would have caught the loss, and explain
why green CI didn't.

This spec is written against `docs/analysis-existing-repo.md`: the app today
has **no auth and no feature flags**, and logging is **silenced under
`NODE_ENV=test`** — which is exactly why all three losses are invisible to the
visible suite. The main-parent commits in the seeded history are what
*introduce* auth and flags to the app.

---

## 1. The feature being merged

**ACME-1454 — Order export for finance.** `GET /api/orders/export` returns all
orders as CSV (`id,customer_id,status,total_cents,payment_capture_id,created_at`),
`Content-Type: text/csv`, `Content-Disposition: attachment; filename="orders.csv"`.
Implemented on branch `feature/order-export` by the fictional developer **Alex
Kimura**. Small, plausible, finance-driven, and — crucially — it touches
`src/routes/orders.ts`, the same file main evolves in parallel.

To make a whole-file "accept incoming" resolution plausible, Alex's branch also
**restructures `src/routes/orders.ts`**: inline handlers extracted to named
functions (`listOrders`, `getOrder`, `createOrder`, new `exportOrders`), imports
reordered, a `toCsv` helper added. Every hunk of the file changes on the feature
side, so when main's parallel edits to the same file collide, the conflict is
gnarly enough that taking one whole side is exactly the lazy resolution a tired
reviewer makes.

The feature branch also adds `test/orders-export.test.ts` (CSV shape, header
row, empty-DB case). These tests survive the merge untouched (no conflict) —
so the *feature* has visible coverage while the *lost behaviors* have none.

---

## 2. The git history to author

### Commit graph

```
M0 ──── A ──── B ──── C ──────────────── M   ← main HEAD = candidate baseline
  \                                     /
   F1 ────────── F2 ───────────────────╯       feature/order-export
```

| Ref | Author | Message (verbatim in the template) | Content |
|---|---|---|---|
| `M0` | — | (current repo bootstrap) | Merge base: the existing app exactly as it is today |
| `A` | Priya Raman | `ACME-1461: require ops key for cross-customer order listing` | New `src/middleware/opsKey.ts`; guard applied inside `routes/orders.ts` GET `/`; `OPS_API_KEY` added to `.env.example` |
| `B` | Priya Raman | `ACME-1468: checkout observability for the duplicate-charge monitor` | `order.checkout` structured log line added to the POST handler in `routes/orders.ts` |
| `C` | Marcus Webb | `ACME-1473: backorder pilot behind FLAG_BACKORDERS` | New `src/lib/flags.ts`; backorder path in `routes/orders.ts` / order flow; `FLAG_BACKORDERS` added to `.env.example` |
| `F1` | Alex Kimura | `ACME-1454: extract order route handlers, add CSV helper` | Restructures `routes/orders.ts` (named handlers, `toCsv`) |
| `F2` | Alex Kimura | `ACME-1454: GET /api/orders/export (CSV for finance)` | Export route + `test/orders-export.test.ts` |
| `M` | Jordan Malik | `Merge branch 'feature/order-export'` | **The wrong resolution** (below) |

Authorship is deliberately multi-person: the person who merged (`Jordan`) is
not the person who wrote either side — a realistic review failure, and it keeps
the candidate from reading the merge as malice.

### The wrong resolution, precisely

On `main` at `C`, Jordan runs `git merge feature/order-export`. Git conflicts
in exactly one file: `src/routes/orders.ts` (A, B, and C each edited hunks that
F1's restructure rewrote). Jordan resolves with **Accept Incoming Change for
the whole file** — i.e. `git checkout --theirs src/routes/orders.ts` — commits,
and pushes. Consequences, file by file:

| File | After merge `M` | Why |
|---|---|---|
| `src/routes/orders.ts` | **Feature-branch version verbatim.** No ops-key guard, no `order.checkout` log line, no backorder branch | The whole-file resolution |
| `src/middleware/opsKey.ts` | Present but **orphaned** (zero importers) | Added by A, no conflict |
| `src/lib/flags.ts` | Present but **orphaned** | Added by C, no conflict |
| `.env.example` | Contains `OPS_API_KEY` and `FLAG_BACKORDERS` entries that nothing reads | Non-conflicting additions from A and C |
| `test/orders-export.test.ts` | Present and green | Feature-side addition |
| Everything else | Clean merge | — |

The orphaned modules and dead `.env.example` entries are the deliberate
**breadcrumbs**: a candidate who greps for importers of `opsKey.ts` or readers
of `FLAG_BACKORDERS` finds the losses even without git archaeology. The
canonical discovery command is `git diff C M -- src/routes/orders.ts` (what
the merge changed relative to the *main* parent — pure deletions of A/B/C's
work), or `git show --cc M`.

### Build requirements for the template

- The candidate repo must be stamped **with this full history**, both parents
  reachable (the merge commit's second parent suffices; do not squash on
  stamping). This is a change from the current single-commit bootstrap.
- `--baseline` for `evaluation/baseline-check/` is **`M` (main HEAD)** — the
  post-bad-merge state. The red/green mechanic is unchanged: the candidate's
  new tests must fail at `M` and pass on their branch. No tooling changes.
- Platform CI gets a `seeded-state-reproduces` job (inversion-guard pattern):
  the new hidden suite must FAIL at `M`; if it passes, someone fixed the seed.

### The ticket the candidate receives

**ACME-1490 (P2), reporter: ops.** "Since the export release on Thursday, the
duplicate-charge monitor has flatlined — zero `order.checkout` events in the
log pipeline, which the dashboard renders as 'no duplicates,' and we know
that's not true. Separately, a partner integration test hit `GET /api/orders`
and got another company's orders back. Both started after the export merge.
Audit that merge: find what regressed, repair it without losing the export
feature, and add coverage so a merge can't silently do this again."

The ticket names symptoms of **two** of the three losses (logging, authz). The
third (the flag guard) is mentioned nowhere — finding it separates candidates
who audit the merge from candidates who fix the reported symptoms. This is the
scenario's ownership probe.

---

## 3. The three seeded behaviors (deleted by the merge)

### 3a. Authorization: ops key on cross-customer listing (from commit A)

- **What it was:** `GET /api/orders` *without* a `customerId` query param
  returns the most recent 100 orders across **all** customers. Commit A guards
  that shape: header `x-ops-key` must equal `config.opsApiKey`
  (`OPS_API_KEY` env). Absent → `401 missing_ops_key`; wrong → `403
  invalid_ops_key`. With `customerId` present, no key is required (the web
  dashboard's path, unchanged).
- **Where it lived:** guard logic in `routes/orders.ts` (the conflicted file),
  implemented in `src/middleware/opsKey.ts` (survives, orphaned). `config.ts`
  gains `opsApiKey` in commit A — *place this addition in `config.ts`* so it
  also survives the merge as another breadcrumb.
- **Why its loss is dangerous:** the bare listing is a cross-tenant data leak —
  one B2B customer can read every other customer's order volumes and
  purchasing patterns. The ticket's partner report is this leak, live.
- **Why the visible suite stays green:** today's `orders.test.ts` exercises
  the listing **only** via `?customerId=` and `/api/customers/:id/orders`
  (`docs/analysis-existing-repo.md` §3). No visible test hits the bare
  listing, with or without a key. Commits A–C ship **no tests** (in-fiction:
  "tests to follow after the pilot" — and that pre-existing gap is itself part
  of the lesson the candidate must articulate in §"why green CI lied").

### 3b. Structured logging: checkout observability fields (from commit B)

- **What it was:** after every successful checkout response, the POST handler
  emits `log.info("order.checkout", { request_id, order_id, customer_id,
  total_cents, item_count, idempotency_key, replayed })`. In-fiction, ops
  built the **duplicate-charge monitor** on `event=order.checkout
  replayed=true` rates after the ACME-1287 incident — this ties the scenario
  into existing repo lore.
- **Where it lived:** entirely inside `routes/orders.ts`. Fully deleted.
- **Why its loss is dangerous:** the monitor doesn't error — it **flatlines**.
  A dead observability signal reads as "everything is fine," which is worse
  than an alert storm: the exact failure mode the ticket reports.
- **Why the visible suite stays green:** the logger self-silences under
  `NODE_ENV=test` (unless `LOG_IN_TESTS=1`, which nothing sets), and no test
  anywhere asserts a log line or field. Log behavior is structurally invisible
  to the current suite.

### 3c. Feature flag: the backorder pilot guard (from commit C)

- **What it was:** `src/lib/flags.ts` — minimal env-based flags
  (`flags.backorders` reads `FLAG_BACKORDERS`, default **off**). When ON and
  requested quantity exceeds stock, checkout does **not** 409: it creates the
  order with `status: 'backordered'`, records line items, decrements no stock,
  defers payment capture (`payment_capture_id` stays null), and returns 201.
  When OFF, behavior is today's `409 insufficient_stock`. No schema change
  (`status` is an unconstrained text column — keep it that way in commit C so
  the scenario adds no migration interplay).
- **Where it lived:** flag module survives orphaned; the guarded branch lived
  in the conflicted file's checkout path and is fully deleted.
- **Why its loss is dangerous:** production runs `FLAG_BACKORDERS=1` for a
  pilot customer (stated in the repo's README delta from commit C). After the
  merge deploys, the pilot's automated purchasing integration silently starts
  receiving 409s where it contractually expects 201-backordered — a behavior
  regression for a specific customer that no internal dashboard shows.
- **Why the visible suite stays green:** tests run with the flag at its
  default (off), and the flag-off path is byte-for-byte the pre-flag behavior
  the existing 409 test asserts. Deleted guard and disabled guard are
  indistinguishable to the visible suite — the classic flag blind spot.

**Design rule enforced across all three:** no visible test may observe any of
these behaviors, and each must leave a survivable breadcrumb outside the
conflicted file (orphaned module, config key, `.env.example` entry, README
line, commit message).

---

## 4. The candidate deliverable

### What "correct" means (outcome contract, not workflow)

1. All three behaviors restored and working at the candidate's branch HEAD.
2. The export feature (and its visible tests) still intact — **reverting the
   merge and calling it done is a failing repair**, and a hidden check
   enforces this.
3. New tests that fail at `M` and pass on their branch (red/green gate) for
   each restored behavior — at minimum authz and the flag path; the logging
   test requires a capture approach (below) and is where strong candidates
   visibly outperform.
4. A PR that explains: what the merge deleted, how they found it, why CI was
   green through the deletion, and what now prevents recurrence.

### Legitimate approaches (expect divergence; score outcomes, never style)

- **Forward-fix (most common):** re-apply the lost hunks onto main — by hand,
  or `git checkout C -- <hunks>`-style surgery, or cherry-picking A/B/C's
  edits and resolving against the restructured file. Fine.
- **Revert-and-remerge:** `git revert -m 1 M`, then re-merge
  `feature/order-export` with a correct resolution. Requires knowing the
  revert-of-a-merge trap (git considers the branch already merged; needs
  revert-of-the-revert or a rebased re-merge). Advanced but legitimate; the
  defense probes whether they understood the trap or stumbled through it.
- **Reconstruct:** branch from `C`, cherry-pick `F1`+`F2`, resolve properly,
  propose replacing main's tip. Legitimate; requires a coherent PR story about
  history rewriting on a shared branch.
- **Logging testability divergence:** some candidates set `LOG_IN_TESTS=1`
  and capture stdout; some refactor the logger for injectability. Both fine.
  Replacing the logger wholesale trips the ACME-871 in-repo warning — that's a
  codebase-comprehension signal, not an instant fail.
- **Authz divergence:** restoring the guard exactly vs. also guarding the
  **export endpoint** — Alex's branch predates commit A, so
  `GET /api/orders/export` ships **unguarded**: a bulk read of all orders with
  no key. Noticing that the merge not only deleted an auth check but
  *introduced* a new unguarded surface is the scenario's stretch finding
  (5-level Security/Systems signal; deliberately **not** a required hidden
  check, since the feature branch never had it — see §5).

### Strong vs. weak, concretely

| Signal | Strong | Weak |
|---|---|---|
| Discovery | Diffs the merge against **each parent** (`git diff C M`, `git show --cc M`); finds all three deletions systematically; cites the orphaned modules | Fixes the two ticket symptoms; never finds the flag guard; treats it as "add missing code" without asking what else the merge ate |
| Repair | Restores behaviors *and* keeps export; each restoration verified by a test that first fails at `M` | Reverts the merge (export gone), or pastes old code back without wiring the flag/config |
| Tests | Covers authz (401/403/200 matrix), flag-on path, and log fields via a deliberate capture strategy | Tests only the happy path, or writes tests that pass at `M` (test-theater; the baseline check catches it) |
| Explanation | Names the real cause — *coverage gap + whole-file resolution*, not "git broke it"; notes the gap predated the merge; proposes prevention (the new tests, and e.g. a review rule for whole-file resolutions) | "CI passed so we thought it was fine"; no prevention story |
| Ownership | Flags the unguarded export endpoint and/or the pilot-customer impact proactively | Silent on everything not in the ticket |

---

## 5. Hidden-suite assertions

New file in the platform repo: `evaluation/hidden-tests/wrong-merge.hidden.test.ts`.
Mechanics identical to the existing pattern: `run.sh` copies it into
`test/hidden/` for the run and deletes it on exit; candidates never see it;
`--summary` (via a new `CHECKS` table in `summarize.mjs`) is the only
candidate-facing output. Check ids below are **public contract** — they render
verbatim in mission control and reports.

| Check id | Verifies restoration of | Assertion (hidden test behavior) |
|---|---|---|
| `authz_check_present` | 3a authz | With `OPS_API_KEY` set in the test env: bare `GET /api/orders` with no key → 401; wrong key → 403; correct key → 200; `?customerId=` path still needs no key. Enforcement on the live route, never source presence |
| `structured_logging_present` | 3b logging | Sets `LOG_IN_TESTS=1` before app import, intercepts `process.stdout.write`; performs a checkout and a same-key replay; asserts `order.checkout` lines carry all seven monitor fields, `replayed=false` then `replayed=true` on the replay |
| `feature_flag_guard_present` | 3c flag | With `FLAG_BACKORDERS=1`: order with quantity > stock → 201, `status: "backordered"`, stock unchanged, `payment_capture_id` null. With flag unset: same request → `409 insufficient_stock` (guard restored *as a guard*, not as always-on behavior) |
| `order_export_intact` | the feature | `GET /api/orders/export` → 200, `text/csv`, header + row for a seeded order (fails the revert-the-merge "repair"; a consolidated rewrite passes — functionality, not verbatim code). The request carries the ops key so a guarded export is not penalized |
| `unrelated_regression` | everything else | Rollup, same pattern as today: totals, stock limits, validation, sequential idempotent replay still correct |

Built as `evaluation/hidden-tests-wrong-merge/` (suite + `summarize.mjs` +
`run.sh <candidate-repo> [--summary]` + the blocking `leak-guard.mjs`); binding
requirements in [`hidden-suite-requirements.md`](hidden-suite-requirements.md).

Notes for the build:

- Baseline behavior: at `M`, checks 1–3 must **fail** and 4–5 must **pass**;
  the platform CI inversion guard asserts exactly that signature (not just
  "suite fails").
- The flag check runs the app in-process with env vars set before import —
  mirror how the existing hidden suite manipulates `PAYMENT_LATENCY_MS`.
- The stdout-capture approach for the logging check lives **only** in the
  hidden file, so the capture technique is never revealed to candidates —
  they must design their own (that design choice is a defense topic).
- Deliberately absent: `export_requires_ops_key`. The feature branch never
  had it, so "restoration" is undefined; it stays a defense/rubric stretch
  signal rather than a pass/fail check.

Summary rendering: five rows, pass/fail/not-run, no test names or assertion
text — byte-compatible with the existing `--summary` consumer surfaces.

---

## 6. Defense questions (generated from the candidate's actual repair)

Five questions target; every un-verifiable claim ties to an artifact in their
diff, PR, or terminal history (corroboration rule — no artifact stands alone).

**Base (always):**

1. **"Show me how you determined what the merge deleted."** Have them run the
   command live (`git diff C M`, `git show --cc M`, grep for orphaned
   importers — any real method). *Listen for:* a repeatable procedure, not "I
   read the ticket and searched for the two symptoms."
2. **"Why did green CI fail to catch a deleted authorization check?"** *Listen
   for:* the two-part answer — no visible test observed the behavior (gap
   predated the merge), and the whole-file resolution deleted code without
   producing a diff any check looked at. "CI only proves what tests assert" in
   their own words. Corroborates the PR's why-green section.
3. **"Which lost behavior was hardest to notice was gone, and what found
   it?"** *Listen for:* honest process. The expected answer is the flag guard
   (nothing in the ticket points at it); a candidate who claims all three were
   equally obvious gets the follow-up "then why does your first commit only
   restore two?" if their history shows that.

**Adaptive (pick by diff shape):**

4. If their logging test captures stdout: **"Your test flips `LOG_IN_TESTS`
   and intercepts stdout — when does that approach break?"** If they
   refactored the logger instead: **"The logger carries an ACME-871 warning —
   what did you check before touching it?"**
5. If they restored the flag: **"`FLAG_BACKORDERS` defaults off, so your
   restored code is dead in every default environment. How did you verify it
   actually works — and who runs with it on?"** *Listen for:* the pilot
   customer, the flag-on test, the deferred-capture semantics.
6. If they reverted the merge at any point (visible in reflog/history/PR):
   **"You reverted a merge commit. What does git believe about
   `feature/order-export` afterwards, and what did that force you to do?"**
7. If their diff touches the export route: **"Should `/api/orders/export`
   require the ops key? Whose mistake is it that it doesn't?"** *Listen for:*
   the timeline reasoning — Alex branched before A existed; this is a process
   gap, not negligence; guarding it is a product decision to raise, not
   silently ship. (Stretch probe; strong answer, unprompted, supports a 5 on
   Security/Systems.)
8. AI question verbatim from the existing bank: **"Which parts of this change
   did an AI tool write, and what did you change or verify before keeping
   them?"**

Scoring maps onto Root-cause analysis, Git discipline & upstream integration,
Systems thinking, Security, AI collaboration. Quote answers verbatim in the
report. "I don't know, I'd check X" outscores confabulation, per the existing
bank's rule.

---

## 7. Rubric and ladder mapping

**Ladder placement: Maintainer→Owner.** Contributor tasks (ACME-1287) hand the
candidate a bug and logs pointing at it. This scenario hands them a *process
failure* with partial symptoms: the unit of work is someone else's merge, the
skill is archaeology + integration repair across three subsystems (auth,
observability, flags), and one loss is only findable by auditing rather than
reproducing. That is repository stewardship — the Maintainer rung's definition
("features spanning multiple modules," "someone else's work is in the repo"),
with the flag/pilot reasoning reaching toward Owner. Timebox: **2h**, per the
per-scenario timebox standard (every assessment declares its own timebox up
front, matched to scenario complexity; running out of time is unassessed,
never failed).

Competency emphasis (anchors to be written in the scenario rubric, gated
identically to ACME-1287 — baseline-check verdict caps the testing row,
telemetry limits apply, U ≠ 1):

| Competency | Weight in this scenario | 5-level looks like | 2-level looks like |
|---|---|---|---|
| Codebase comprehension | **Core** | Uses parent-diff archaeology; finds orphaned modules; connects `.env.example` breadcrumbs | Greps only for the ticket's symptom strings |
| Root-cause analysis | **Core** | Names the resolution *event* (whole-file accept-incoming) as the cause, all three losses as consequences | Treats each symptom as an independent bug |
| Git discipline & integration | **Core** | Repair keeps export + history coherent; if reverting, handles the revert-of-merge trap knowingly | Revert loses the feature; or conflict markers / force-push damage |
| Testing (red/green gated) | **Core** | Three restorations each proven by a baseline-failing test, incl. a deliberate log-capture design | Tests pass at `M` (test-theater) or cover authz only |
| Security | Elevated | Restores the guard, articulates the tenant-leak blast radius, flags the unguarded export unprompted | Restores mechanically, can't say what it protected |
| Systems thinking | Elevated | Flag semantics (default-off, pilot env), monitor-flatline failure mode, deferred capture | "Put the code back" with no environmental reasoning |
| Communication | Elevated | PR's why-green section is teachable; prevention proposed | Restates the diff |
| Ownership | Elevated | Finds behavior #3 without being told; surfaces pilot-customer impact | Stops at the ticket's two symptoms |
| Data safety / Deployment judgment | Present, lighter | No migration in scenario; deploy story = restore order + flag env confirmation | — |

**Report/summary integration:** the workflow-events table for this scenario
replaces the ACME-1287 rows with: found-all-three (yes / two / one), repair
strategy (forward-fix / revert-remerge / reconstruct — recorded, never
scored), export preserved (yes/no), why-green explanation present (yes/thin/no),
stretch finding raised (yes/no). Hidden-summary table lists the five check ids
from §5 verbatim.

---

## Build checklist (delta against the readiness checklist in the analysis doc)

- [ ] Author commits A, B, C, F1, F2, M on a scenario branch of the template,
      exactly as §2 (contents, authors, messages); verify `git diff C M --
      src/routes/orders.ts` shows pure deletion of the three behaviors.
- [ ] Auth middleware, flags module, backorder path, and log line implemented
      *in the parents*, never reaching `M`'s working tree via `routes/orders.ts`.
- [ ] Visible suite at `M`: green, and provably silent on all three behaviors.
- [ ] Hidden file + new `CHECKS` table; at `M` the summary reads exactly
      fail/fail/fail/pass/pass in §5 order.
- [ ] Platform CI `seeded-state-reproduces` job asserting that signature.
- [ ] Template stamping preserves full history (both merge parents reachable).
- [ ] Scenario rubric anchors, defense bank (§6), report tables, ticket text,
      and proctor notes authored; ACME-1287's tripwire/upstream/Redis elements
      explicitly **not** reused here (this scenario's history *is* the drama).
