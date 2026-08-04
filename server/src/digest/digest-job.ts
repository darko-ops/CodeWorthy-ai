// The weekly-digest job. A scheduled task (Fly cron / a scheduled workflow)
// runs this to send the digest to the configured recipients.
//
//   npm run digest
//
// No recipients configured -> no-op (exit 0), so it's safe to schedule before
// email is set up. Uses the console mailer when no SMTP is configured, so in dev
// you SEE the digest rather than nothing happening.
import { Pool } from "pg";
import { config } from "../config.js";
import { makeMailer, type Mailer } from "../mail/mailer.js";
import { sendDigest, type SendDigestResult } from "./send.js";

export async function runDigestJob(
  pool: Pool,
  mailer: Mailer = makeMailer(config.mail),
  opts: { to?: string; repo?: string; periodDays?: number } = {}
): Promise<{ status: "no-recipients" | "sent"; result?: SendDigestResult }> {
  const to = (opts.to ?? config.mail.digestTo)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (to.length === 0) return { status: "no-recipients" };

  const result = await sendDigest(pool, mailer, { to, repo: opts.repo, periodDays: opts.periodDays ?? 7, from: config.mail.from });
  return { status: "sent", result };
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    const out = await runDigestJob(pool);
    if (out.status === "no-recipients") console.log("[digest] no recipients configured (set STEWARD_DIGEST_TO) — nothing sent");
    else console.log(`[digest] sent to ${Array.isArray(out.result!.to) ? out.result!.to.join(", ") : out.result!.to}: ${JSON.stringify(out.result!.subject)} (${out.result!.totalEvents} events, ${out.result!.alertCount} alerts)`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
