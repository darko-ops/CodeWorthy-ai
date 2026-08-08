// The portfolio overview — every repo the user watches, at a high level, in a
// few batched queries rather than a full health report per repo.
//
// Per-repo status is computed the SAME way as the single-repo health card so
// the two never disagree: protection = the latest protection event; review =
// direct-to-default vs pull-request counts in the window. Integrity is a global
// property of the append-only chain, so it's checked once and reported at the
// top, not per repo.
import type { Pool } from "pg";
import { config } from "../config.js";
import { verifyAuditChain, verifyAgainstAnchor, makeAnchor } from "../audit/tamper.js";
import { flaggedCountsByRepo } from "../digest/digest.js";
import type { VitalStatus } from "./health.js";

type ProtStatus = "healthy" | "watch" | "at risk";
export type Overall = "Healthy" | "Needs attention" | "At risk" | "Quiet";

export interface RepoOverview {
  full_name: string;
  overall: Overall;
  protection: ProtStatus;
  review: VitalStatus;
  flagged: number;
  events: number; // events in the window
  lastActivity: string | null; // ISO, all-time
}

export interface OverviewReport {
  generatedAt: string;
  windowDays: number;
  repos: RepoOverview[];
  totals: { repos: number; needsAttention: number; atRisk: number; flagged: number };
  integrity: { ok: boolean; headline: string };
}

// Mirrors health.ts worst(): unknown is ignored; else the worst known wins.
function worst(xs: VitalStatus[]): VitalStatus {
  const known = xs.filter((s) => s !== "unknown");
  if (!known.length) return "unknown";
  return known.some((s) => s === "at risk") ? "at risk" : known.some((s) => s === "watch") ? "watch" : "healthy";
}
const OVERALL: Record<VitalStatus, Overall> = {
  "at risk": "At risk",
  watch: "Needs attention",
  healthy: "Healthy",
  unknown: "Quiet",
};
const reviewStatus = (rc?: { direct: number; prs: number }): VitalStatus => {
  if (!rc || (rc.direct === 0 && rc.prs === 0)) return "unknown";
  if (rc.direct === 0) return "healthy";
  return rc.prs > 0 ? "watch" : "at risk";
};

export async function buildOverview(pool: Pool, repos: string[], windowDays = 30): Promise<OverviewReport> {
  const days = Math.min(Math.max(windowDays, 1), 90);
  const uniq = [...new Set(repos)];

  // Integrity is global (the whole hash chain) — check once.
  const chain = await verifyAuditChain(pool);
  const sink = makeAnchor(config.anchor);
  const anchor = sink ? await verifyAgainstAnchor(pool, sink) : { status: "no-anchor" as const };
  const integrityOk = chain.intact && anchor.status !== "tampered";
  const integrity = {
    ok: integrityOk,
    headline: integrityOk
      ? "The change record is intact and tamper-evident."
      : "The change record failed verification — open a repo's Details to review.",
  };

  if (!uniq.length) {
    return {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      repos: [],
      totals: { repos: 0, needsAttention: 0, atRisk: 0, flagged: 0 },
      integrity,
    };
  }

  // Latest protection state per repo.
  const prot = new Map<string, ProtStatus>();
  {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (repo) repo, event_type FROM audit_events
        WHERE repo = ANY($1) AND event_type IN ('protection.configured','protection.weakened')
        ORDER BY repo, ts DESC, id DESC`,
      [uniq]
    );
    for (const r of rows) prot.set(r.repo, r.event_type === "protection.weakened" ? "at risk" : "healthy");
  }

  // Review discipline: direct-to-default vs PR counts per repo, in the window.
  const review = new Map<string, { direct: number; prs: number }>();
  {
    const { rows } = await pool.query(
      `SELECT repo, event_type, count(*)::int AS n FROM audit_events
        WHERE repo = ANY($1) AND ts >= now() - make_interval(days => $2)
          AND event_type IN ('push.direct_to_default','pull_request.opened','pull_request.merged')
        GROUP BY repo, event_type`,
      [uniq, days]
    );
    for (const r of rows) {
      const e = review.get(r.repo) ?? { direct: 0, prs: 0 };
      if (r.event_type === "push.direct_to_default") e.direct += r.n;
      else e.prs += r.n;
      review.set(r.repo, e);
    }
  }

  // Events in window per repo.
  const eventTotals = new Map<string, number>();
  {
    const { rows } = await pool.query(
      `SELECT repo, count(*)::int AS n FROM audit_events
        WHERE repo = ANY($1) AND ts >= now() - make_interval(days => $2) GROUP BY repo`,
      [uniq, days]
    );
    for (const r of rows) eventTotals.set(r.repo, r.n);
  }

  // Last activity per repo, all-time.
  const lastAct = new Map<string, string>();
  {
    const { rows } = await pool.query(`SELECT repo, max(ts) AS last_ts FROM audit_events WHERE repo = ANY($1) GROUP BY repo`, [
      uniq,
    ]);
    for (const r of rows) lastAct.set(r.repo, r.last_ts instanceof Date ? r.last_ts.toISOString() : String(r.last_ts));
  }

  const flags = await flaggedCountsByRepo(pool, uniq, days);

  const list: RepoOverview[] = uniq.map((full_name) => {
    const protection = prot.get(full_name) ?? "watch";
    const rev = reviewStatus(review.get(full_name));
    const overall = OVERALL[worst([protection, rev])];
    return {
      full_name,
      overall,
      protection,
      review: rev,
      flagged: flags[full_name] ?? 0,
      events: eventTotals.get(full_name) ?? 0,
      lastActivity: lastAct.get(full_name) ?? null,
    };
  });

  // Most-attention first, then by flagged, then by activity.
  const rank: Record<Overall, number> = { "At risk": 0, "Needs attention": 1, Healthy: 2, Quiet: 3 };
  list.sort((a, b) => rank[a.overall] - rank[b.overall] || b.flagged - a.flagged || b.events - a.events);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    repos: list,
    totals: {
      repos: list.length,
      needsAttention: list.filter((r) => r.overall === "Needs attention").length,
      atRisk: list.filter((r) => r.overall === "At risk").length,
      flagged: list.reduce((n, r) => n + r.flagged, 0),
    },
    integrity,
  };
}
