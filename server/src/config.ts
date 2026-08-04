// Runtime configuration for the CodeWorthy backend service.
export const config = {
  port: parseInt(process.env.PORT ?? "8080", 10),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward",
  github: {
    appId: process.env.GITHUB_APP_ID ?? "",
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    // PEM stored with escaped newlines in env; restore real newlines here.
    privateKey: (process.env.GITHUB_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  },
  // M3. Off unless explicitly enabled AND the installation opts in. The
  // deterministic gate and checkup never call out; only this tier does.
  llmEnabled: process.env.STEWARD_LLM_ENABLED === "1",
  // M2. Auto-configuring branch protection changes a customer's repo settings,
  // so it is opt-in (consent) and off by default — never silent.
  autoProtect: process.env.STEWARD_AUTO_PROTECT === "1",
  // M1.5. WORM anchor for the audit hash chain's head. Precedence: S3 (prod) >
  // file (dev) > none. When set, the integrity endpoint also checks the chain
  // head against the anchor, and the anchor job (npm run anchor) pins it.
  anchor: {
    // Prod: an S3 bucket with Object Lock enabled. Credentials come from the
    // default AWS chain (instance/task role) — never from env here.
    s3Bucket: process.env.STEWARD_ANCHOR_S3_BUCKET ?? "",
    s3Prefix: process.env.STEWARD_ANCHOR_S3_PREFIX ?? "",
    s3Region: process.env.STEWARD_ANCHOR_S3_REGION ?? process.env.AWS_REGION ?? "",
    // Object Lock compliance window in days (default 10 years).
    retentionDays: parseInt(process.env.STEWARD_ANCHOR_RETENTION_DAYS ?? "3650", 10),
    // Dev/self-host fallback: an append-only file on disk.
    file: process.env.STEWARD_ANCHOR_FILE ?? "",
  },
  // Public base URL of this service — used to build the App manifest URLs
  // (webhook / setup / callback) and links in the digest email.
  baseUrl: (process.env.STEWARD_BASE_URL ?? "http://localhost:8080").replace(/\/+$/, ""),
  // The GitHub App's slug (from its URL: github.com/apps/<slug>). Drives the
  // "Install on GitHub" button on the consent page.
  appSlug: process.env.GITHUB_APP_SLUG ?? "",
  // Digest email delivery. No SMTP URL -> a console mailer (dev): the digest is
  // rendered and logged, never silently dropped. Precedence: SMTP > console.
  mail: {
    smtpUrl: process.env.STEWARD_SMTP_URL ?? "", // e.g. smtps://user:pass@smtp.host:465
    from: process.env.STEWARD_MAIL_FROM ?? "CodeWorthy <steward@codeworthy.dev>",
    digestTo: process.env.STEWARD_DIGEST_TO ?? "", // comma-separated recipients
  },
  // Run the in-process scheduler (anchor nightly, digest weekly) inside this
  // service. On a single always-on instance this is the whole cron story; for a
  // multi-instance deploy, run it on exactly one machine (or split to Fly
  // scheduled machines) so a job never double-fires.
  scheduler: process.env.STEWARD_SCHEDULER === "1",
};
