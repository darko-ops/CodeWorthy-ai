# Deploying the CodeWorthy Steward

A single always-on Node service on **Fly.io** + managed Postgres on **Neon**.
One machine serves the webhook, the API, the health page, and (with the
scheduler on) the nightly anchor + weekly digest. From zero to live:

## 1. Postgres (Neon)

Create a Neon project and copy its **pooled** connection string. That's your
`DATABASE_URL` (include `?sslmode=require`). The release command runs the
migrations on every deploy — no manual DB setup.

## 2. Register the GitHub App

Deploy first (steps 3–4) so `STEWARD_BASE_URL` is reachable, then open
`https://<your-app>.fly.dev/steward/app-manifest` and click **Create App on
GitHub**. GitHub returns the `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, private key,
and webhook secret — set them as secrets (step 4) and redeploy.

## 3. Create the Fly app

```bash
fly launch --no-deploy          # or: fly apps create codeworthy-steward
```

Edit `fly.toml` so `app` and `STEWARD_BASE_URL` match your app name.

## 4. Secrets (never in fly.toml)

```bash
fly secrets set \
  DATABASE_URL='postgres://…neon…/db?sslmode=require' \
  GITHUB_APP_ID='123456' \
  GITHUB_APP_SLUG='codeworthy-steward' \
  GITHUB_WEBHOOK_SECRET='…' \
  GITHUB_PRIVATE_KEY='-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----'

# Digest email (optional; without it the digest logs to the console)
fly secrets set STEWARD_SMTP_URL='smtps://user:pass@smtp.host:465' \
  STEWARD_MAIL_FROM='CodeWorthy <steward@yourdomain>' \
  STEWARD_DIGEST_TO='founder@acme.com'

# WORM anchor (optional; S3 Object Lock — see ../README.md "WORM anchor setup")
fly secrets set STEWARD_ANCHOR_S3_BUCKET='my-codeworthy-audit' \
  STEWARD_ANCHOR_S3_REGION='us-east-1' \
  AWS_ACCESS_KEY_ID='…' AWS_SECRET_ACCESS_KEY='…'
```

`GITHUB_PRIVATE_KEY` uses literal `\n` for newlines — the app restores them.

## 5. Deploy

```bash
fly deploy
```

The release command applies migrations; the machine then serves on `:8080`.
Point the GitHub App's webhook at `https://<your-app>.fly.dev/webhooks/github`
(the manifest already set this).

## Scheduled jobs

`STEWARD_SCHEDULER=1` (default in `fly.toml`) runs the periodic jobs **inside**
the service — nightly anchoring, weekly digest — which is why the app is pinned
to a single machine (`max_machines_running = 1`) so a job never double-fires.

To scale past one instance, set `STEWARD_SCHEDULER=0` and run the jobs as Fly
scheduled machines instead:

```bash
fly machine run . --schedule daily  --command "node dist/audit/anchor-job.js"
fly machine run . --schedule weekly --command "node dist/digest/digest-job.js"
```

(You can also invoke them ad hoc: `fly ssh console -C "node dist/audit/anchor-job.js"`.)

## Verify

- `GET /health` → `{ ok: true }`
- `GET /steward/integrity` → chain + anchor status
- `GET /steward/health.html?repo=owner/name` → the repo health page
- Share `https://<your-app>.fly.dev/steward/install` to onboard a repo.
