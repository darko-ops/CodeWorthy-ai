// Runtime configuration for the CodeWorthy backend service.
export const config = {
  port: parseInt(process.env.PORT ?? "8080", 10),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://acme@localhost:55432/steward",
  github: {
    appId: process.env.GITHUB_APP_ID ?? "",
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? "",
    // PEM stored with escaped newlines in env; restore real newlines here.
    privateKey: (process.env.GITHUB_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    // GitHub App user-to-server OAuth (the "Sign in with GitHub" dashboard flow).
    // The App already has a client_id; a client secret is generated in the App
    // settings. When either is unset, the sign-in routes report "not configured"
    // rather than 500 — the frontend degrades to a clear state.
    clientId: process.env.GITHUB_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
  },
  // M3. Off unless explicitly enabled AND the installation opts in. The
  // deterministic gate and checkup never call out; only this tier does.
  llmEnabled: process.env.STEWARD_LLM_ENABLED === "1",
  // M2. Auto-configuring branch protection changes a customer's repo settings,
  // so it is opt-in (consent) and off by default — never silent.
  autoProtect: process.env.STEWARD_AUTO_PROTECT === "1",
  // The enforcement spine. Turning protection ON is always a human decision
  // (autoProtect above, or the consent click on /steward/setup). KEEPING it on
  // is the product: once consented, drift is corrected rather than merely
  // reported. Set STEWARD_RESTORE_PROTECTION=0 for report-only stewardship.
  protection: {
    restoreDrift: process.env.STEWARD_RESTORE_PROTECTION !== "0",
    // The backstop sweep. Webhooks are the fast path (seconds); this is what
    // makes the guarantee independent of any single webhook delivery.
    sweepMinutes: Math.max(5, parseInt(process.env.STEWARD_PROTECTION_SWEEP_MINUTES ?? "60", 10) || 60),
  },
  // The independent approver — a SEPARATE GitHub App, with its own credentials
  // and its own identity in the audit trail. Separate on purpose: the actor
  // that reviews a change must not be the actor that approves it, or the
  // approval is the reviewer agreeing with itself. Unset -> no approver exists,
  // and protection never requires an approval nobody can give.
  approver: {
    appId: process.env.APPROVER_APP_ID ?? "",
    privateKey: (process.env.APPROVER_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    // Default: approve once CodeWorthy's blocking findings are addressed.
    // "strict" re-reviews the diff independently and forms its own opinion.
    strict: process.env.APPROVER_STRICT === "1",
  },
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
  // The dashboard SPA origin (codeworthy.ai) — the OAuth callback redirects the
  // browser back here, and CORS allows it to call the /api/* endpoints.
  webBaseUrl: (process.env.STEWARD_WEB_BASE_URL ?? "https://codeworthy.ai").replace(/\/+$/, ""),
  // Extra browser origins allowed to call /api/* (comma-separated). The apex and
  // www forms of webBaseUrl are always allowed — see app/webOrigins.ts for why
  // that mattered. Use this for a preview deployment or a second domain.
  webOriginsExtra: process.env.STEWARD_WEB_ORIGINS ?? "",
  // Secret used to (a) HMAC-sign the OAuth `state` (CSRF) and (b) derive session
  // ids. Any long random string. Unset -> a boot-time random, which is fine for
  // a single instance but means sessions don't survive a restart.
  sessionSecret: process.env.STEWARD_SESSION_SECRET ?? "",
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
