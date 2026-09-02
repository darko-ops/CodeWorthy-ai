// The weekly digest — the plain-language artifact a founder sees, built over the
// audit spine. Same data serves the SOC 2 auditor (every change, who, when).
// Pure: reads the append-only log, categorizes, summarizes. No side effects.
import type { Pool } from "pg";

export interface DigestEntry {
  ts: string;
  repo: string;
  actor: string | null;
  eventType: string;
  plainEnglish: string;
}

export type Tone = "alert" | "attention" | "good" | "neutral";

export interface DigestSection {
  key: string;
  label: string;
  tone: Tone;
  count: number;
  entries: DigestEntry[];
}

export interface Digest {
  repoFilter: string | null;
  periodDays: number;
  generatedAt: string;
  totalEvents: number;
  headline: string;
  alerts: DigestEntry[]; // the "look at this" — weakened protection, skipped review
  sections: DigestSection[];
  timeline: DigestEntry[];
}

// event_type -> how a non-engineer should read it.
const CATEGORY: Record<string, { key: string; label: string; tone: Tone }> = {
  "protection.weakened": { key: "protection_alert", label: "Protection weakened", tone: "alert" }, // pre-V0.3 name, kept for history
  "exception.protection_weakened": { key: "protection_alert", label: "Protection weakened", tone: "alert" },
  "exception.force_push": { key: "exceptions", label: "Exceptions", tone: "alert" },
  "exception.merged_red_checks": { key: "exceptions", label: "Exceptions", tone: "alert" },
  "push.direct_to_default": { key: "skipped_review", label: "Changes that skipped review", tone: "attention" },
  "mechanic.retroactive_review": { key: "skipped_review", label: "Changes that skipped review", tone: "attention" },
  "pull_request.opened": { key: "prs", label: "Pull requests", tone: "good" },
  "pull_request.merged": { key: "prs", label: "Pull requests", tone: "good" },
  "change.merged": { key: "prs", label: "Pull requests", tone: "good" },
  "protection.configured": { key: "protection", label: "Protection turned on", tone: "good" },
  "installation.created": { key: "lifecycle", label: "Setup", tone: "neutral" },
  "installation.deleted": { key: "lifecycle", label: "Setup", tone: "neutral" },
};
// Any exception.* not named above is still an alert — the family contract
// (V0.3): exceptions are the look-at-this register, never "other activity".
const categorize = (t: string) =>
  CATEGORY[t] ??
  (t.startsWith("exception.")
    ? { key: "exceptions", label: "Exceptions", tone: "alert" as Tone }
    : { key: "other", label: "Other activity", tone: "neutral" as Tone });

// The event types that count as "flagged" (a look-at-this) — derived from the
// same CATEGORY the digest/details use, so the rail badge, the ring, and the
// details view never disagree.
export function alertEventTypes(): string[] {
  return Object.entries(CATEGORY)
    .filter(([, m]) => m.tone === "alert" || m.tone === "attention")
    .map(([t]) => t);
}

// CodeWorthy's own RESPONSE to a finding is not itself a finding. Every direct
// push produces a mechanic.retroactive_review too, so counting both scored one
// unreviewed change as two problems — a repo looked twice as bad for the fact
// that CodeWorthy had already dealt with it.
const RESPONSE_EVENT_TYPES = ["mechanic.retroactive_review"];

// Findings that a later event CLOSES. A weakening that was restored, or a push
// from before protection went on, is history: it stays in the record and in the
// digest, but it is not something still waiting on the user. Without this, a
// repo that is now completely healthy kept showing flags for a month — which
// teaches people the number does not mean anything.
const CLOSED_BY_PROTECTION = [
  "push.direct_to_default",
  "protection.weakened",
  "exception.protection_weakened",
  "exception.protection_unavailable",
  "exception.protection_check_failed",
  "exception.protection_rule_edited",
  "exception.protection_rule_deleted",
];
// Deliberately NOT closable: exception.force_push, exception.protection_bypassed
// and exception.merged_red_checks describe something that happened and cannot
// be undone by a later setting. They stay counted for the window — that is what
// an exception register is for.

/** The alert types worth counting as an OPEN finding. */
export function openFlagEventTypes(): string[] {
  return alertEventTypes().filter((t) => !RESPONSE_EVENT_TYPES.includes(t));
}

/**
 * SQL that keeps only findings still outstanding.
 *
 * `$1` repos, `$2` counted types, `$3` window days, `$4` protection-closable
 * types. Shared by the count and the trend so a row's bars always sum to its
 * number — two copies of this rule would drift apart immediately.
 */
const OPEN_FINDINGS_FROM = `
  FROM audit_events e
  LEFT JOIN (
    SELECT repo,
           max(ts) FILTER (WHERE event_type IN ('protection.configured','protection.restored')) AS protected_at,
           max(ts) FILTER (WHERE event_type = 'gate.evaluated')                                 AS gated_at
      FROM audit_events WHERE repo = ANY($1) GROUP BY repo
  ) c ON c.repo = e.repo
  WHERE e.repo = ANY($1) AND e.event_type = ANY($2)
    AND e.ts >= now() - make_interval(days => $3)
    AND NOT (e.event_type = ANY($4) AND c.protected_at IS NOT NULL AND c.protected_at > e.ts)
    AND NOT (e.event_type = 'exception.gate_unavailable' AND c.gated_at IS NOT NULL AND c.gated_at > e.ts)`;

// Open-finding counts per repo over a window, in one query. Powers the rail's
// "spot a problem repo" badges without running a full health report per repo.
export async function flaggedCountsByRepo(
  pool: Pool,
  repos: string[],
  sinceDays: number
): Promise<Record<string, number>> {
  if (!repos.length) return {};
  const days = Math.min(Math.max(sinceDays, 1), 365);
  const res = await pool.query(
    `SELECT e.repo, count(*)::int AS n ${OPEN_FINDINGS_FROM} GROUP BY e.repo`,
    [repos, openFlagEventTypes(), days, CLOSED_BY_PROTECTION]
  );
  const out: Record<string, number> = {};
  for (const r of res.rows) out[r.repo] = r.n;
  return out;
}

/** How many periods the flagged trend is split into. Ten is what the overview
 *  table's sparkline draws; keeping it here means the shape is a server fact
 *  rather than something the UI invents. */
export const FLAGGED_BUCKETS = 10;

// Flagged events per repo, split into FLAGGED_BUCKETS equal periods across the
// window, oldest first — the overview table's trend line. Same event types as
// flaggedCountsByRepo, so each row's bars always sum to its flagged count.
export async function flaggedBucketsByRepo(
  pool: Pool,
  repos: string[],
  sinceDays: number
): Promise<Record<string, number[]>> {
  if (!repos.length) return {};
  const days = Math.min(Math.max(sinceDays, 1), 365);
  const res = await pool.query(
    // The bucket index is the elapsed fraction of the window, clamped so an
    // event landing exactly at `now` doesn't fall off the end.
    `SELECT e.repo,
            least($5::int - 1,
                  floor(extract(epoch from (e.ts - (now() - make_interval(days => $3))))
                        / (($3::float * 86400) / $5::float))::int) AS bucket,
            count(*)::int AS n
       ${OPEN_FINDINGS_FROM}
      GROUP BY e.repo, bucket`,
    [repos, openFlagEventTypes(), days, CLOSED_BY_PROTECTION, FLAGGED_BUCKETS]
  );
  const out: Record<string, number[]> = {};
  for (const r of res.rows) {
    const b = Number(r.bucket);
    if (!Number.isFinite(b) || b < 0 || b >= FLAGGED_BUCKETS) continue;
    (out[r.repo] ??= new Array<number>(FLAGGED_BUCKETS).fill(0))[b] = r.n;
  }
  return out;
}

export async function buildDigest(
  pool: Pool,
  opts: { repo?: string; periodDays?: number } = {}
): Promise<Digest> {
  const periodDays = Math.min(Math.max(opts.periodDays ?? 7, 1), 90);
  const rows = opts.repo
    ? (await pool.query(
        `SELECT ts, repo, actor, event_type, plain_english FROM audit_events
         WHERE ts >= now() - make_interval(days => $1) AND repo = $2 ORDER BY ts DESC`,
        [periodDays, opts.repo]
      )).rows
    : (await pool.query(
        `SELECT ts, repo, actor, event_type, plain_english FROM audit_events
         WHERE ts >= now() - make_interval(days => $1) ORDER BY ts DESC`,
        [periodDays]
      )).rows;

  const timeline: DigestEntry[] = rows.map((r) => ({
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    repo: r.repo,
    actor: r.actor,
    eventType: r.event_type,
    plainEnglish: r.plain_english,
  }));

  // group into sections
  const byKey = new Map<string, DigestSection>();
  for (const e of timeline) {
    const c = categorize(e.eventType);
    let s = byKey.get(c.key);
    if (!s) { s = { key: c.key, label: c.label, tone: c.tone, count: 0, entries: [] }; byKey.set(c.key, s); }
    s.count++; s.entries.push(e);
  }
  const toneRank: Record<Tone, number> = { alert: 0, attention: 1, good: 2, neutral: 3 };
  const sections = [...byKey.values()].sort((a, b) => toneRank[a.tone] - toneRank[b.tone]);

  const alerts = timeline.filter((e) => {
    const t = categorize(e.eventType).tone;
    return t === "alert" || t === "attention";
  });

  const counts = (t: string) => timeline.filter((e) => e.eventType === t).length;
  const headline = buildHeadline(opts.repo ?? null, timeline.length, {
    direct: counts("push.direct_to_default"),
    weakened: counts("protection.weakened") + counts("exception.protection_weakened"),
    prs: counts("pull_request.opened"),
    protection: counts("protection.configured"),
  });

  return {
    repoFilter: opts.repo ?? null,
    periodDays,
    generatedAt: new Date().toISOString(),
    totalEvents: timeline.length,
    headline,
    alerts,
    sections,
    timeline,
  };
}

function buildHeadline(repo: string | null, total: number, c: { direct: number; weakened: number; prs: number; protection: number }): string {
  const where = repo ? ` in ${repo}` : "";
  if (total === 0) return `Nothing tracked${where} in this period — quiet week.`;
  const parts: string[] = [`${total} tracked change-event(s)${where}.`];
  if (c.weakened) parts.push(`⚠️ Branch protection was weakened ${c.weakened} time(s) — worth a look.`);
  if (c.direct) parts.push(`${c.direct} change(s) went straight to the default branch with no review.`);
  if (c.prs) parts.push(`${c.prs} pull request(s) opened.`);
  if (c.protection) parts.push(`Protection was turned on ${c.protection} time(s).`);
  if (!c.weakened && !c.direct) parts.push(`Nothing needs your attention.`);
  return parts.join(" ");
}
