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
import { flaggedCountsByRepo, flaggedBucketsByRepo, FLAGGED_BUCKETS } from "../digest/digest.js";
import { buildIssues } from "./remediation.js";
import { getRepoModes, DEFAULT_MODE } from "../steward/repoMode.js";
import type { HealthVital, VitalStatus } from "./health.js";

type ProtStatus = "healthy" | "watch" | "at risk";
export type Overall = "Healthy" | "Needs attention" | "At risk" | "Quiet";

/** What the caller knows about a repo before any audit data is read. A bare
 *  full name still works — the branch then reads as "main", the way the health
 *  report's own remediation context defaults it. */
export interface OverviewRepoInput {
  full_name: string;
  private?: boolean;
  default_branch?: string;
}

export interface RepoOverview {
  full_name: string;
  private: boolean;
  defaultBranch: string;
  overall: Overall;
  protection: ProtStatus;
  review: VitalStatus;
  flagged: number;
  /** Flagged events per equal period across the window, oldest first. */
  flaggedBuckets: number[];
  events: number; // events in the window
  /** Changes that reached the default branch in the window (merged PRs + direct
   *  pushes) — the same count the repo's own change log shows. */
  merges: number;
  /** The headline of the worst thing still waiting on a decision, or null. */
  decision: string | null;
  lastActivity: string | null; // ISO, all-time
}

export interface OverviewReport {
  generatedAt: string;
  windowDays: number;
  repos: RepoOverview[];
  totals: { repos: number; needsAttention: number; atRisk: number; healthy: number; quiet: number; flagged: number };
  /** `chain` mirrors the single-repo health report's wording, so the estate-wide
   *  record strip can state the real length of the chain rather than a number
   *  the UI made up. */
  integrity: { ok: boolean; headline: string; chain: string };
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

// The status a vital would have to carry for buildIssues to raise its issue.
// Only `id` and `status` decide WHICH issues exist and what they're titled; the
// findings are the repo's own screen to fill in, and the table only reads the
// top title. Running the real vital builders here would cost three queries per
// repo on a screen that already answers in four.
const asVital = (id: string, status: VitalStatus): HealthVital => ({
  id,
  label: id,
  status,
  finding: "",
  prescription: "",
});

export async function buildOverview(
  pool: Pool,
  repos: Array<string | OverviewRepoInput>,
  windowDays = 30
): Promise<OverviewReport> {
  const days = Math.min(Math.max(windowDays, 1), 90);
  const inputs = new Map<string, OverviewRepoInput>();
  for (const r of repos) {
    const i = typeof r === "string" ? { full_name: r } : r;
    if (!inputs.has(i.full_name)) inputs.set(i.full_name, i);
  }
  const uniq = [...inputs.keys()];

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
    chain: chain.intact ? `intact (${chain.checked} entries)` : `broken at entry ${chain.brokenAtSeq} (${chain.reason})`,
  };

  if (!uniq.length) {
    return {
      generatedAt: new Date().toISOString(),
      windowDays: days,
      repos: [],
      totals: { repos: 0, needsAttention: 0, atRisk: 0, healthy: 0, quiet: 0, flagged: 0 },
      integrity,
    };
  }

  // Latest protection state per repo.
  const prot = new Map<string, ProtStatus>();
  const latestProt = new Map<string, string>();
  {
    const { rows } = await pool.query(
      // Must match the event vocabulary in health.ts protectionVital, or the
      // portfolio row and the repo's own card disagree. `protection.restored`
      // is a HEALTHY end state; the pre-V0.3 `protection.weakened` name is kept
      // because history is never renamed.
      `SELECT DISTINCT ON (repo) repo, event_type FROM audit_events
        WHERE repo = ANY($1) AND event_type IN (
          'protection.configured','protection.restored',
          'protection.weakened','exception.protection_weakened','exception.protection_unavailable'
        )
        ORDER BY repo, ts DESC, id DESC`,
      [uniq]
    );
    const WEAK = new Set(["protection.weakened", "exception.protection_weakened", "exception.protection_unavailable"]);
    for (const r of rows) {
      prot.set(r.repo, WEAK.has(r.event_type) ? "at risk" : "healthy");
      latestProt.set(r.repo, r.event_type);
    }
  }

  // Review discipline: direct-to-default vs PR counts in the window, plus the
  // merges that reached the default branch (a merged PR, or a direct push —
  // the same two event types the repo's change-log counters add up).
  const review = new Map<string, { direct: number; prs: number }>();
  const merges = new Map<string, number>();
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
      if (r.event_type === "push.direct_to_default" || r.event_type === "pull_request.merged") {
        merges.set(r.repo, (merges.get(r.repo) ?? 0) + r.n);
      }
    }
  }

  // The merge gate's windowed behaviour: a change that merged without a verdict
  // is an untested control, and it's a decision the table has to be able to name.
  const gate = new Map<string, VitalStatus>();
  {
    const { rows } = await pool.query(
      `SELECT repo,
              count(*) FILTER (WHERE event_type = 'gate.evaluated')::int            AS evaluated,
              count(*) FILTER (WHERE event_type = 'exception.gate_unavailable')::int AS unavailable
         FROM audit_events
        WHERE repo = ANY($1) AND ts >= now() - make_interval(days => $2)
          AND event_type IN ('gate.evaluated','exception.gate_unavailable')
        GROUP BY repo`,
      [uniq, days]
    );
    for (const r of rows) {
      const evaluated = Number(r.evaluated ?? 0);
      const unavailable = Number(r.unavailable ?? 0);
      gate.set(r.repo, unavailable > 0 ? "watch" : evaluated > 0 ? "healthy" : "unknown");
    }
  }

  // Findings the user already settled deliberately — buildIssues drops those,
  // so the table must know about them too or it offers a decision that's made.
  // Same rule as health.ts: the latest of accept/unaccept wins, because
  // withdrawing an acceptance appends rather than erasing.
  const accepted = new Map<string, Set<string>>();
  {
    const { rows } = await pool.query(
      `SELECT repo, issue_id FROM (
         SELECT DISTINCT ON (repo, payload->>'issueId')
                repo, payload->>'issueId' AS issue_id, event_type
           FROM audit_events
          WHERE repo = ANY($1) AND event_type IN ('issue.accepted','issue.unaccepted')
            AND payload->>'issueId' IS NOT NULL
          ORDER BY repo, payload->>'issueId', ts DESC, id DESC
       ) latest WHERE event_type = 'issue.accepted'`,
      [uniq]
    );
    for (const r of rows) (accepted.get(r.repo) ?? accepted.set(r.repo, new Set()).get(r.repo)!).add(r.issue_id);
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

  // Direct pushes SINCE protection went on, per repo. The portfolio has to
  // split this the same way the repo's own screen does — otherwise the overview
  // keeps naming a decision ("2 changes went straight to main") that the repo
  // page has already stopped raising because the cause is fixed, and the two
  // views contradict each other.
  const directSince = new Map<string, number>();
  {
    const { rows } = await pool.query(
      `SELECT e.repo, count(*)::int AS n FROM audit_events e
        WHERE e.repo = ANY($1) AND e.event_type = 'push.direct_to_default'
          AND e.ts >= now() - make_interval(days => $2)
          AND e.ts > coalesce((SELECT max(p.ts) FROM audit_events p
                                WHERE p.repo = e.repo
                                  AND p.event_type IN ('protection.configured','protection.restored')),
                              'epoch'::timestamptz)
        GROUP BY e.repo`,
      [uniq, days]
    );
    for (const r of rows) directSince.set(r.repo, r.n);
  }

  const flags = await flaggedCountsByRepo(pool, uniq, days);
  const buckets = await flaggedBucketsByRepo(pool, uniq, days);
  const modes = await getRepoModes(pool, uniq);

  const list: RepoOverview[] = uniq.map((full_name) => {
    const input = inputs.get(full_name)!;
    const defaultBranch = input.default_branch || "main";
    const protection = prot.get(full_name) ?? "watch";
    const rev = reviewStatus(review.get(full_name));
    const overall = OVERALL[worst([protection, rev])];

    // The same engine the repo's own screen runs, so the row names the decision
    // the user will actually be offered when they click into it — worst first.
    const issues = buildIssues(
      [
        asVital("protection", protection),
        asVital("review_discipline", rev),
        asVital("merge_gate", gate.get(full_name) ?? "unknown"),
        // Integrity is global; a failed chain is every repo's problem.
        asVital("integrity", integrityOk ? "healthy" : "at risk"),
      ],
      {
        repo: full_name,
        defaultBranch,
        mode: modes.get(full_name) ?? DEFAULT_MODE,
        latestProtectionEvent: latestProt.get(full_name) ?? null,
        restoreDrift: config.protection.restoreDrift,
        directPushes: review.get(full_name)?.direct ?? 0,
        directPushesSinceProtection: directSince.get(full_name) ?? 0,
        protectionInPlace:
          latestProt.get(full_name) === "protection.configured" || latestProt.get(full_name) === "protection.restored",
        accepted: accepted.get(full_name) ?? new Set<string>(),
      }
    );

    return {
      full_name,
      private: input.private ?? false,
      defaultBranch,
      overall,
      protection,
      review: rev,
      flagged: flags[full_name] ?? 0,
      flaggedBuckets: buckets[full_name] ?? new Array<number>(FLAGGED_BUCKETS).fill(0),
      events: eventTotals.get(full_name) ?? 0,
      merges: merges.get(full_name) ?? 0,
      decision: issues[0]?.title ?? null,
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
      healthy: list.filter((r) => r.overall === "Healthy").length,
      quiet: list.filter((r) => r.overall === "Quiet").length,
      flagged: list.reduce((n, r) => n + r.flagged, 0),
    },
    integrity,
  };
}
