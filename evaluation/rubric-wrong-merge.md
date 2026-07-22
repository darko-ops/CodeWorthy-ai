# Scoring Rubric — ACME-1490 (The Wrong Merge Resolution)

Score each competency 1–5 with cited evidence (diff, tests, PR text, defense
answers, hidden-test results). Never collapse to a single number. Mark
competencies the candidate ran out of time for as **unassessed**, not 1.

Ladder placement: **Maintainer→Owner.** The unit of work is someone else's
merge; the skill is git archaeology plus integration repair across three
subsystems (auth, observability, flags), and one loss is only findable by
auditing rather than reproducing. Timebox 2h.

## The seeded scenario (reviewer context)

A prior developer (Jordan Malik) merged `feature/order-export` and resolved the
one conflicted file — `src/routes/orders.ts` — by taking the incoming side
whole ("accept incoming change" / `checkout --theirs`). CI stayed green. The
whole-file resolution silently deleted three behaviors that lived only on the
main parent:

1. **Authorization (from commit A, `68ec8bc`):** the ops-key guard on the bare
   `GET /api/orders` cross-customer listing. Its loss is the ticket's
   cross-tenant leak.
2. **Structured logging (from commit B, `40f6adb`):** the `order.checkout` log
   line the duplicate-charge monitor consumes. Its loss is the ticket's monitor
   flatline.
3. **Feature-flag guard (from commit C, `8444911`):** the `FLAG_BACKORDERS`
   backorder path. **Not mentioned in the ticket** — finding it separates
   candidates who audit the merge from candidates who fix reported symptoms.

The breadcrumbs survive the merge orphaned: `src/middleware/opsKey.ts`,
`src/lib/flags.ts`, `config.opsApiKey`, `.env.example` (`OPS_API_KEY`,
`FLAG_BACKORDERS`), and an orphaned `createBackorder` method in
`src/services/orderService.ts`. The canonical discovery command is
`git diff 8444911 9997d60 -- src/routes/orders.ts` (what the merge deleted
relative to the *main* parent — pure deletions) or `git show --cc 9997d60`.

**Why green CI lied** (the candidate must articulate this): the app had no auth
or flags before these commits and the logger self-silences under `NODE_ENV=test`,
so no visible test ever observed any of the three behaviors. Commits A–C shipped
no tests. The coverage gap predated the merge; the whole-file resolution then
deleted code without producing a diff any check looked at.

## Competency anchors

### Codebase comprehension — **Core**
- **5** — Uses parent-diff archaeology (`git diff C M`, `git show --cc M`); finds the orphaned modules and `.env.example`/config breadcrumbs; connects each to a deleted behavior.
- **3** — Finds the two ticket symptoms by grepping for their strings; partial understanding of how they were lost.
- **2** — Greps only for the symptom strings; treats the fix as "add missing code" without asking what else the merge ate.
- **1** — Cannot locate the losses or explain the merge.

### Root-cause analysis — **Core**
- **5** — Names the *resolution event* (whole-file accept-incoming) as the single cause and all three losses as its consequences.
- **3** — Identifies the merge as the cause but treats each symptom as an independent bug.
- **1** — "git broke it"; no coherent cause.

### Git discipline & integration — **Core**
- **5** — Repair restores all three behaviors *and* keeps the export feature + a coherent history; if reverting, handles the revert-of-a-merge trap knowingly.
- **3** — Correct end state but messy history (never scored for style — score only what a teammate would inherit: nothing lost, no markers committed).
- **2** — Reverts the merge and loses the feature; or pastes old code back without wiring config/flag.
- **1** — Conflict markers committed, force-push damage, or the feature is broken.

### Testing (red/green gated) — **Core**
Gated by the baseline-check verdict exactly as ACME-1287: only `genuine-regression-test` (fails at `M`, passes on branch) can score above 2. `test-theater` (passes at `M`) caps this row at 2.
- **5** — Each restored behavior proven by a baseline-failing test, including a deliberate log-capture design for the observability field check.
- **4** — Baseline-passing tests for authz and the flag path; logging untested or lightly.
- **3** — One restoration covered (usually authz); others asserted only by hand.
- **2** — Tests pass at `M` (test-theater), or only the happy path.
- **1** — No meaningful test.

### Security — **Elevated**
- **5** — Restores the guard, articulates the tenant-leak blast radius, and flags **unprompted** that Alex's export route (`GET /api/orders/export`) ships *unguarded* — a new bulk-read surface the merge introduced.
- **3** — Restores the guard, explains what it protects.
- **1** — Restores mechanically, can't say what it protected.

### Systems thinking — **Elevated**
- **5** — Reasons about flag semantics (default-off, the pilot env that runs it on), the monitor-flatline failure mode, and deferred-capture backorder semantics.
- **3** — Handles the reported behaviors without environmental reasoning.
- **1** — "Put the code back" with no systems context.

### Communication — **Elevated**
- **5** — The PR's why-green section is teachable; a concrete prevention proposal (the new tests, and e.g. a review rule against whole-file resolutions).
- **3** — Restates the diff; prevention thin.
- **1** — "CI passed so we thought it was fine," no prevention.

### Ownership — **Elevated**
- **5** — Finds behavior #3 (the flag) without being told; surfaces the pilot-customer impact proactively.
- **3** — Fixes the two named symptoms competently; finds the third only when prompted.
- **1** — Stops at the ticket's two symptoms.

### Data safety / Deployment judgment — **Present, lighter**
No migration in this scenario (`status` is unconstrained text). Deploy story = restore order + confirm the flag env for the pilot; rollback = revert the repair, feature intact.

## Scoring hygiene (telemetry limits)

Identical to ACME-1287: git/GitHub artifacts are evidence, not a complete
record. Never score commit count, time-to-first-commit, workflow style (revert
vs forward-fix vs reconstruct — recorded, never scored), or amount of AI use.
Score reviewability, verifiable tests, preserved feature + history, and whether
the PR/handoff lets a teammate understand the repair.

## Hidden-suite interpretation

| Hidden result at the candidate's branch | Meaning |
|---|---|
| `authz_check_present` fail | Guard not restored, or restored as source-only (not enforced on the live route) |
| `structured_logging_present` fail | Log line missing or missing monitor fields / `replayed` flag |
| `feature_flag_guard_present` fail | Flag path not restored, or restored always-on instead of as a guard (flag-off must still 409) |
| `order_export_intact` fail | Export lost — usually a revert-the-merge "repair" |
| `unrelated_regression` fail | Repair broke totals / stock / validation / sequential idempotent replay |
| All five pass | Verify understanding via defense before scoring the judgment rows 4+ |

The signature at the seeded baseline `M` is **fail / fail / fail / pass / pass**
(checks 1–3 fail, 4–5 pass); the platform CI asserts exactly that.
