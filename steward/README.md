# CodeWorthy Steward — the hosted GitHub App

The enforcement half of CodeWorthy's trust layer, hosted: safe git mechanics,
branch protection a non-engineer can turn on, an append-only SOC 2 audit log,
and an **advise-only** AI reviewer. It implements
`docs/ai-senior-engineer-policy.md`; the Actions tier (`enforcement/`) stays
the deterministic gate that runs in the customer's own CI.

**The doctrine, enforced by tests (`test/doctrine.test.mjs`):**
- No API surface for merging, deleting refs, or force-updates — the client
  cannot express them, so no bug can perform them. The human owns every merge.
- The AI reviewer can only ever conclude `neutral`. The model never gates
  (decision 2026-08-05). Deterministic checks gate; the model coaches.

## What it does

| Tier | Behavior |
|---|---|
| Safe-mechanics | Push to a branch with no PR → Steward opens a **draft PR** with a plain-language scaffold. Empty PR description → drafted, clearly marked. Direct push to the default branch → a **restore-point branch** at the pre-push commit + a plain-language commit comment (never a force-push — see below). |
| Protection | `.steward.yml` with `protect: true` is **configuration-as-consent**: Steward applies PR-required / no-force-push / no-deletion protection (zero required approvals, so solo builders aren't locked out), re-applies on drift, and logs every change — including weakenings. |
| Audit | Every event appends to a per-repo **hash chain** in Postgres, written by a role that can only INSERT/SELECT (`db/schema.sql`). `GET /api/log?repo=` is the plain-language change log; `GET /api/verify?repo=` recomputes the chain. |
| Micro-defense | Non-trivial PRs get one question ("what does this do, what could break?"). Any human answer turns the check green — presence is verified, understanding is scaffolded, content is never graded. |
| AI review (flagged) | `STEWARD_LLM=1` **and** `llm_review: true` in the repo config → rubric-prompted review posted as COMMENT-only findings, each citing its policy row. Check conclusion is structurally `neutral`. |

### An honest note on "auto-branch when someone edits main"

Once a push has landed on `main`, moving it to a branch would mean rewriting
`main` — a force-push, which Steward forbids itself. So the mechanics are:
prevention (draft PRs appear on branch pushes so the PR flow costs nothing;
protection blocks direct pushes once consented) plus recovery (restore-point
branch + coaching when a direct push does land). Nothing is ever rewritten.

## Run

```bash
npm install && npm test          # 27 offline tests, no network, no DB
node src/server.mjs              # needs env below
```

| Env | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres, as role `steward_app` (apply `db/schema.sql` as owner first) |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | App credentials (PEM; `\n`-escaped OK) |
| `GITHUB_WEBHOOK_SECRET` | webhook HMAC |
| `STEWARD_LOG_TOKEN` | bearer token for `/api/log` and `/api/verify` |
| `STEWARD_LLM` + `ANTHROPIC_API_KEY` | optional advise-only AI review |

## Deploy (Fly + Neon)

1. `neonctl` or console: create project, run `db/schema.sql` as owner, create
   the `steward_app` connection string.
2. Create the GitHub App from `app-manifest.json` (Settings → Developer
   settings → GitHub Apps → New; or the manifest flow). Generate a private key.
3. `cd steward && fly launch --copy-config` then `fly secrets set` the table
   above, `fly deploy`.
4. Install the App on a repo; commit `.steward.yml` with `protect: true` when
   ready for the guardrail.
