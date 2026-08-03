# CodeWorthy Server — Steward App + API (M1)

The backend service. One deployment, two bounded modules (a **modular
monolith**, per the approved architecture):

- **`src/steward/`** — the Steward GitHub App: webhook handler + the audit
  spine. Auth: GitHub App installation tokens.
- **`src/api/`** — the site's Phase 2 backend seed. Auth: user auth (to come).
  Separate schema; shares the process and the Postgres connection so the two
  can split cleanly later.

Recommended host: a single always-on Node service (Fly.io) + Neon Postgres —
not serverless (LLM calls run 30–120s; the audit log wants a real connection).

## What M1 is (the spine everything logs through)

- **Webhook intake** (`steward/routes.ts`, `webhook.ts`) — verifies the GitHub
  HMAC over the raw body (constant-time), then dispatches.
- **Event → audit mapping** (`steward/events.ts`) — M1 observes and logs
  (installations, direct-to-default pushes, PR open/merge). The *actions*
  (safe-mechanics, protection config) are M2 and will append here too.
- **The audit spine** (`audit/`, `db/migrations/0001_audit_events.sql`) —
  append-only, plain-language, one record for both the founder digest and a SOC
  2 auditor. Immutability is enforced **two ways**: a least-privilege DB grant
  (INSERT+SELECT only) *and* a schema trigger that blocks UPDATE/DELETE for any
  role. The `/steward/changelog` endpoint renders the plain-language log.
- **The GitHub client doctrine** (`github/client.ts` + `client.doctrine.test.ts`)
  — the client surface exposes only safe, additive, reversible operations.
  There is **no merge, no force-push, no delete** — not "we don't call them,"
  but "the capability isn't on the surface." A CI test fails the build if anyone
  adds one. The human owns every merge.
- **Config** (`steward/stewardConfig.ts`) — `.steward.yml` with safe defaults;
  malformed config falls back to defaults, never crashes; the LLM tier is
  opt-in (`false`) by default.

## What M2 adds (safe-mechanics + protection)

- **App auth** (`github/auth.ts`) — mints a short-lived App JWT (RS256) and
  exchanges it for an installation token; `getInstallationClient(id)` is how
  the App acts on a repo.
- **Safe-mechanics** (`steward/mechanics.ts`) — on a direct-to-default push it
  preserves a `steward/edit-<sha>` branch and leaves a plain-language comment on
  the exact commit that skipped review, then logs it. **Honest semantics:** the
  commit is already on the branch, and turning it into a PR after the fact would
  need a force-push we forbid — so it doesn't fake a PR it can't open. The cure
  is protection (below), which stops the *next* one.
- **Branch-protection configurator** (`steward/protection.ts`) — requires a PR +
  the `CodeWorthy PR review` check and blocks force-pushes/deletions. Applied
  **only with consent** (`STEWARD_AUTO_PROTECT=1`; the real product consents on
  the install screen) — never silently changing repo settings.
- **Drift detection** — `runDriftCheck` compares live protection to desired and
  logs a `protection.weakened` audit event (the thing SOC 2 auditors care
  about). A scheduled job calls it per installation; the schedule is deployment
  config (Fly cron / a scheduled workflow).
- **Actions dispatch** (`steward/actions.ts`) — runs after logging, fully
  guarded: no App creds or no installation → no-op (local stays M1 log-only);
  protection auto-config is consent-gated. Injectable client for tests.

## What M3 adds (the LLM advise tier — advises, never gates)

`src/steward/llm/` — the one place a reasoning model looks at a change. **Off by
default; opt-in on both sides** (`STEWARD_LLM_ENABLED=1` operator-side *and*
`llm.enabled: true` in the repo's `.steward.yml` — `llmReviewEnabled()` requires
both). No `ANTHROPIC_API_KEY` → the tier is a silent no-op (deterministic-only).

- **`prompt.ts`** — the system prompt *is* the policy: the model-judgment rows of
  `docs/ai-senior-engineer-policy.md` and the rubric anchors, distilled and
  version-controlled here (no runtime dependency on repo file layout). The diff
  is capped (per-file + total); when capped, the comment **says so** rather than
  reviewing a fraction and implying it saw everything. `REVIEW_SCHEMA` forces
  every finding to cite a file + line range.
- **`anthropic.ts`** — the injectable `LlmClient` seam (`@anthropic-ai/sdk`,
  default `claude-opus-5`, adaptive thinking, structured output). Tests run
  offline against a fake; the real client is built only when the tier is on and
  a key is present.
- **`reviewer.ts`** — `reviewPullRequest()` **advises, never gates**, and it's
  structural: it only ever calls `getPullRequestFiles` (read) and
  `createReviewComment` (post one comment). It never touches
  `setBranchProtection` and never posts the `CodeWorthy PR review` check branch
  protection requires — so it *cannot* block a merge, even by accident. The
  deterministic gate does the gating; a model finding is advice a human reads.
  Every run posts one comment (advisory framing + evidence-cited findings +
  micro-defense + **data-flow disclosure**) and logs an `llm.reviewed` audit
  event.
- **`microdefense.ts`** — a **presence** check, never auto-graded. Green when the
  PR author replies to the one question in their own words; the answer is
  surfaced verbatim, never scored (auto-judging it would betray the assessment
  doctrine — never collapse a human's understanding into a model's pass/fail).
- Wired into `actions.ts` on `pull_request` opened/synchronize, doubly guarded
  and injectable.

## Deferred (by decision)

- **Tamper-evidence** (hash chain + WORM/S3 anchoring) → **M1.5**, gated on a
  design partner asking. The columns add additively; the table contract holds.
- **Weekly digest / change-log page** → **M4** ✅ (`src/digest/`, served at `/steward/digest[.html|.txt]`).
- **Promoting an LLM finding to a gate** — deliberately *not* built. A model
  finding stays advice until it's calibrated against real outcomes; only then
  would a specific, proven check graduate to the deterministic gate tier.

## Run it

```bash
npm install
export DATABASE_URL=postgres://user:pass@host:5432/codeworthy
npm run migrate
npm run dev            # service on :8080
npm test               # audit append-only, doctrine, signature, config, mapping
npm run typecheck
```

Tests need a disposable Postgres (`DATABASE_URL`, default a local `steward_test`).

## Endpoints (M1)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/api/health` | api module seam (DB check) |
| POST | `/webhooks/github` | signed webhook intake → audit |
| GET | `/steward/changelog?repo=&limit=` | plain-language change log |

## The invariant

CodeWorthy never merges, force-pushes, or rewrites history. It gates, advises,
and does safe reversible mechanics; the human owns every merge. `client.ts`
makes that structural and `client.doctrine.test.ts` makes it CI-enforced.
