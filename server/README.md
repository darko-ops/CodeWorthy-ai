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

## What M1.5 adds (tamper-evidence — from append-only to provable)

M1 stops the app and ordinary roles from mutating history. M1.5 makes tampering
by an *insider* — someone who can `DISABLE TRIGGER` and edit rows directly —
**detectable**. Two layers, both in `audit/tamper.ts` + `0002_audit_hash_chain.sql`:

- **A DB-computed hash chain.** A `BEFORE INSERT` trigger sets
  `row_hash = sha256(prev_hash ‖ canonical(row))`, serialized by an advisory lock
  into one linear chain. It's in the DB, not the app, so it binds **every**
  writer — even a raw `psql` insert. `audit_canonical()` is a SQL function shared
  by the trigger *and* the verifier, so the recompute can't drift from the
  original. `verifyAuditChain()` recomputes the whole chain in one SQL pass and
  returns the **first** row that breaks, classified as `content` (a field was
  edited) or `linkage` (a row was deleted or reordered).
- **External WORM anchoring.** The chain alone can't catch an insider who
  rewrites *every* row and recomputes the *whole* chain (it stays internally
  consistent). `anchorAuditHead()` pins the chain head to write-once storage
  **outside** the DB; `verifyAgainstAnchor()` proves the anchored row is still
  present and unchanged. The `Anchor` seam is injectable — `InMemoryAnchor`
  (tests), `FileAnchor` (dev), and **`S3ObjectLockAnchor` (prod)**.
- **The prod anchor** (`S3ObjectLockAnchor`) PUTs each head to an S3 bucket with
  **Object Lock in COMPLIANCE mode** — write-once, undeletable and unoverwritable
  for the retention window, *even by the account root* — plus `IfNoneMatch: "*"`
  so an anchored head can never be clobbered. Keys are zero-padded seq, so
  `latest()` is a cheap max-key scan. Credentials come from the default AWS chain
  (an instance/task role — no secrets in env). The transport is injectable, so
  the wiring (key scheme, lock params, retention date, latest-selection) is
  unit-tested offline against a fake S3; `@aws-sdk/client-s3` is dynamic-imported
  so a deployment that never sets a bucket doesn't pay to load it.
- **`GET /steward/integrity`** — an auditor or the founder asks "has the record
  been tampered with?" and gets a straight `{ ok, chain, anchor }`.
- **The anchor job** (`npm run anchor`, `src/audit/anchor-job.ts`) — a scheduled
  task (Fly cron / a scheduled workflow). It **verifies the chain and the prior
  anchor before writing a new one**, so it can't launder tampering into the
  record: a broken chain or a drifted anchored head makes it exit `2` (page on
  it) instead of anchoring. Idempotent — a run with an unchanged head is a no-op.

All additive: the M1 table contract and existing rows are untouched, and
`appendAuditEvent` didn't change — the trigger fills the new columns.

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

- **Tamper-evidence** (hash chain + WORM/S3 anchoring) → **M1.5** ✅
  (`src/audit/tamper.ts`, `db/migrations/0002_audit_hash_chain.sql`, served at
  `/steward/integrity`, anchored by `npm run anchor`). The deployment provides
  the bucket + IAM; see **WORM anchor setup** below.
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

## Onboarding a real user (install flow + digest email)

**Register the App (once):** open `/steward/app-manifest` → "Create App on GitHub"
(the manifest asks for the honest minimum — `contents: read`, `pull_requests: write`,
`administration: write`, `checks: write`, `metadata: read`; no code-write, no merge).
GitHub redirects back with the credentials; set `GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `STEWARD_BASE_URL`, then redeploy.

**A user installs:** share `/steward/install` — it states what CodeWorthy will and
won't do, then sends them to GitHub to pick repos. GitHub returns them to
`/steward/setup`, where the single consented action ("Protect my default branch")
applies branch protection to the installation's repos — never silently.

**Digest email:** the digest is *rendered* by M4; this wires *delivery*.

```bash
export STEWARD_SMTP_URL='smtps://user:pass@smtp.host:465'   # omit -> console mailer (dev)
export STEWARD_MAIL_FROM='CodeWorthy <steward@yourdomain>'
export STEWARD_DIGEST_TO='founder@acme.com'                 # comma-separated
npm run digest                                             # send now; schedule weekly via cron
```

With no `STEWARD_SMTP_URL`, `npm run digest` uses the **console mailer** — it prints
the email instead of dropping it, so dev shows you exactly what would send. With no
`STEWARD_DIGEST_TO`, the job is a safe no-op.

## WORM anchor setup (prod tamper-evidence)

The anchor is what makes the audit log's integrity provable to an auditor. One-time:

1. **Create an S3 bucket with Object Lock enabled** (must be enabled at creation).
   A default retention isn't required — the app sets per-object COMPLIANCE
   retention on each PUT.
2. **Grant the service's role** `s3:PutObject`, `s3:GetObject`, and
   `s3:ListBucket` on that bucket. No delete permission is needed or wanted.
   Credentials resolve from the default AWS chain (instance/task role) — don't
   put keys in env.
3. **Point the service at it:**

   ```bash
   export STEWARD_ANCHOR_S3_BUCKET=my-codeworthy-audit
   export STEWARD_ANCHOR_S3_REGION=us-east-1      # or AWS_REGION
   export STEWARD_ANCHOR_S3_PREFIX=prod/          # optional
   export STEWARD_ANCHOR_RETENTION_DAYS=3650      # optional; default 10 years
   ```

   Dev/self-host without S3: set `STEWARD_ANCHOR_FILE=/path/anchors.jsonl` instead
   (S3 wins if both are set). With neither, `/steward/integrity` still verifies
   the in-DB chain and reports `no-anchor`.
4. **Schedule the anchor job** (`npm run anchor`) on an interval — nightly is
   typical. It verifies the chain + prior anchor, then pins the current head;
   it exits `2` on detected tampering, so wire that to an alert.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/api/health` | api module seam (DB check) |
| POST | `/webhooks/github` | signed webhook intake → audit |
| GET | `/steward/changelog?repo=&limit=` | plain-language change log |
| GET | `/steward/integrity` | tamper-evidence check (M1.5) — verify the hash chain + WORM anchor |
| GET | `/steward/digest[.html\|.txt]?repo=&days=` | weekly digest (M4) |
| GET | `/steward/health[.html]?repo=&days=` | the repo health page — one pull-up chart (vitals + activity + integrity), no login |
| GET | `/steward/install` | consent landing — what it will/won't do, then "Install on GitHub" |
| GET | `/steward/setup` | post-install page — the one consented action (protect the default branch) |
| POST | `/steward/setup/protect` | apply branch protection to the installation's repos (on the click) |
| GET | `/steward/app-manifest[/callback]` | one-click GitHub App registration (manifest create + credential exchange) |

## The invariant

CodeWorthy never merges, force-pushes, or rewrites history. It gates, advises,
and does safe reversible mechanics; the human owns every merge. `client.ts`
makes that structural and `client.doctrine.test.ts` makes it CI-enforced.
