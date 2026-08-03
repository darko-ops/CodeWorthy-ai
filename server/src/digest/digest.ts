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
  "protection.weakened": { key: "protection_alert", label: "Protection weakened", tone: "alert" },
  "push.direct_to_default": { key: "skipped_review", label: "Changes that skipped review", tone: "attention" },
  "mechanic.retroactive_review": { key: "skipped_review", label: "Changes that skipped review", tone: "attention" },
  "pull_request.opened": { key: "prs", label: "Pull requests", tone: "good" },
  "pull_request.merged": { key: "prs", label: "Pull requests", tone: "good" },
  "protection.configured": { key: "protection", label: "Protection turned on", tone: "good" },
  "installation.created": { key: "lifecycle", label: "Setup", tone: "neutral" },
  "installation.deleted": { key: "lifecycle", label: "Setup", tone: "neutral" },
};
const categorize = (t: string) => CATEGORY[t] ?? { key: "other", label: "Other activity", tone: "neutral" as Tone };

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
    weakened: counts("protection.weakened"),
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
