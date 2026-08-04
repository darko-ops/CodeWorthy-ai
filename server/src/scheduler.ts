// The in-process scheduler. The chosen architecture is a single always-on Node
// service, so the periodic jobs (M1.5 anchoring, M4 digest) run here rather than
// as separate infrastructure. Enabled by STEWARD_SCHEDULER=1 — and it must run
// on exactly one instance so a job never double-fires.
//
// The jobs it runs are the same ones you can invoke by hand (npm run anchor /
// npm run digest); both are safe no-ops when unconfigured, so turning the
// scheduler on before email or an anchor is set up does nothing harmful.
import type { Pool } from "pg";
import { runAnchorJob } from "./audit/anchor-job.js";
import { runDigestJob } from "./digest/digest-job.js";
import type { Anchor } from "./audit/tamper.js";
import type { Mailer } from "./mail/mailer.js";

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

export interface SchedulerDeps {
  anchor?: Anchor; // injected in tests; else resolved from config by the job
  mailer?: Mailer;
}

export interface SchedulerOptions {
  anchorMs?: number; // default: daily
  digestMs?: number; // default: weekly
  log?: (line: string) => void;
}

export interface SchedulerHandle {
  stop(): void;
}

// Run one anchor tick + one digest tick now. Extracted so it's testable without
// waiting on real timers, and so a deploy can trigger a run on boot if it wants.
export async function runScheduledJobs(pool: Pool, deps: SchedulerDeps = {}, log: (l: string) => void = () => {}): Promise<void> {
  try {
    const a = await runAnchorJob(pool, deps.anchor);
    log(`[scheduler] anchor: ${a.status}${a.detail ? ` — ${a.detail}` : ""}`);
  } catch (err) {
    log(`[scheduler] anchor failed: ${err instanceof Error ? err.message : err}`);
  }
  try {
    const d = await runDigestJob(pool, deps.mailer);
    log(`[scheduler] digest: ${d.status}`);
  } catch (err) {
    log(`[scheduler] digest failed: ${err instanceof Error ? err.message : err}`);
  }
}

export function startScheduler(pool: Pool, deps: SchedulerDeps = {}, opts: SchedulerOptions = {}): SchedulerHandle {
  const log = opts.log ?? ((l: string) => console.log(l));
  const anchorMs = opts.anchorMs ?? DAY;
  const digestMs = opts.digestMs ?? WEEK;

  const runAnchor = () =>
    runAnchorJob(pool, deps.anchor)
      .then((r) => log(`[scheduler] anchor: ${r.status}${r.detail ? ` — ${r.detail}` : ""}`))
      .catch((err) => log(`[scheduler] anchor failed: ${err instanceof Error ? err.message : err}`));
  const runDigest = () =>
    runDigestJob(pool, deps.mailer)
      .then((r) => log(`[scheduler] digest: ${r.status}`))
      .catch((err) => log(`[scheduler] digest failed: ${err instanceof Error ? err.message : err}`));

  const t1 = setInterval(runAnchor, anchorMs);
  const t2 = setInterval(runDigest, digestMs);
  // Don't hold the event loop open for the timers alone.
  t1.unref?.();
  t2.unref?.();
  log(`[scheduler] started — anchor every ${Math.round(anchorMs / 3600000)}h, digest every ${Math.round(digestMs / 3600000)}h`);
  return { stop() { clearInterval(t1); clearInterval(t2); } };
}
