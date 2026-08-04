// Send the weekly digest — the wiring that turns the rendered digest (M4) into
// an email that actually reaches the founder. Pure composition over buildDigest
// + the renderers + an injectable Mailer.
import type { Pool } from "pg";
import { buildDigest } from "./digest.js";
import { renderDigestHtml, renderDigestText } from "./render.js";
import type { Mailer } from "../mail/mailer.js";

export interface SendDigestOpts {
  to: string | string[];
  repo?: string;
  periodDays?: number;
  from?: string;
}

export interface SendDigestResult {
  sent: boolean;
  to: string | string[];
  subject: string;
  totalEvents: number;
  alertCount: number;
}

// The subject earns the open: lead with the alert count when something needs
// attention, otherwise a calm all-clear.
function subjectFor(repo: string | null, alertCount: number): string {
  const where = repo ? ` — ${repo}` : "";
  if (alertCount > 0) return `⚠️ CodeWorthy: ${alertCount} thing(s) need your attention${where}`;
  return `CodeWorthy: your week${where} — all clear`;
}

export async function sendDigest(pool: Pool, mailer: Mailer, opts: SendDigestOpts): Promise<SendDigestResult> {
  const digest = await buildDigest(pool, { repo: opts.repo, periodDays: opts.periodDays ?? 7 });
  const subject = subjectFor(digest.repoFilter, digest.alerts.length);
  await mailer.send({
    to: opts.to,
    from: opts.from,
    subject,
    html: renderDigestHtml(digest),
    text: renderDigestText(digest),
  });
  return { sent: true, to: opts.to, subject, totalEvents: digest.totalEvents, alertCount: digest.alerts.length };
}
