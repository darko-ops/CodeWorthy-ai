// The repo health page (tier 3 — the one pull-up chart).
//
// Folds three things into a single doctor's-chart the founder or an auditor can
// open on demand, no login:
//   1. Vitals — the health signals the Steward actually knows from the audit
//      spine (branch protection, review discipline, record integrity). It does
//      NOT run a filesystem checkup: the client doctrine is metadata-only, never
//      execute customer code. The on-disk vitals (tests, secrets, deps) live in
//      the CI Action, where the code already is; this is the Steward's chart of
//      *behavior over time*, which the Action can't see.
//   2. Activity — the plain-language change log (reuses the weekly digest).
//   3. Integrity — the tamper-evidence answer (hash chain + WORM anchor).
//
// Ethics, inherited: this rates a REPO's health, not people. No per-person
// ranking, no lines-of-code-as-goodness. Every vital shows its finding.
import type { Pool } from "pg";
import { buildDigest, type DigestEntry } from "../digest/digest.js";
import { verifyAuditChain, verifyAgainstAnchor, makeAnchor, type Anchor } from "../audit/tamper.js";
import { config } from "../config.js";
import { DEFAULT_MODE, getRepoMode, type RepoMode } from "../steward/repoMode.js";
import { buildIssues, type RepoIssue } from "./remediation.js";

export type VitalStatus = "healthy" | "watch" | "at risk" | "unknown";

export interface HealthVital {
  id: string;
  label: string;
  status: VitalStatus;
  finding: string;
  prescription: string;
}

export interface HealthReport {
  repoFilter: string | null;
  /** How this repo is worked on — drives what "healthy" means for it. */
  mode: RepoMode;
  generatedAt: string;
  overall: "Healthy" | "Needs attention" | "At risk";
  vitals: HealthVital[];
  activity: { total: number; windowDays: number; alerts: DigestEntry[]; recent: DigestEntry[] };
  integrity: { ok: boolean; headline: string; chain: string; anchor: string };
  /** Ranked fix paths for everything unhealthy. Empty when there's nothing to do. */
  issues: RepoIssue[];
  note: string;
}

const RANK: Record<VitalStatus, number> = { "at risk": 1, watch: 2, healthy: 3, unknown: 4 };
const worst = (xs: VitalStatus[]): VitalStatus => {
  const known = xs.filter((s) => s !== "unknown");
  if (!known.length) return "unknown";
  return known.some((s) => s === "at risk") ? "at risk" : known.some((s) => s === "watch") ? "watch" : "healthy";
};

export interface HealthDeps {
  anchor?: Anchor | null; // injected in tests; else resolved from config
}

export async function buildHealthReport(
  pool: Pool,
  opts: { repo?: string; windowDays?: number; defaultBranch?: string } = {},
  deps: HealthDeps = {}
): Promise<HealthReport> {
  const repo = opts.repo ?? null;
  const windowDays = Math.min(Math.max(opts.windowDays ?? 30, 1), 90);

  const integrityResult = await integrityVitalAndSection(pool, deps);
  const mode = repo ? await getRepoMode(pool, repo) : DEFAULT_MODE;
  const vitals: HealthVital[] = [
    await protectionVital(pool, repo, mode),
    await mergeGateVital(pool, repo, windowDays),
    await reviewDisciplineVital(pool, repo, windowDays, mode),
    integrityResult.vital,
  ];
  const integrity = integrityResult.section;

  const overallStatus = worst(vitals.map((v) => v.status));
  const overall = overallStatus === "at risk" ? "At risk" : overallStatus === "watch" ? "Needs attention" : "Healthy";

  const digest = await buildDigest(pool, { repo: repo ?? undefined, periodDays: windowDays });

  // Fix paths are per-repo: the portfolio view has no single branch to act on.
  const issues = repo
    ? buildIssues(vitals, await remediationContext(pool, repo, windowDays, mode, opts.defaultBranch))
    : [];

  return {
    repoFilter: repo,
    mode,
    generatedAt: new Date().toISOString(),
    overall,
    vitals,
    activity: { total: digest.totalEvents, windowDays, alerts: digest.alerts, recent: digest.timeline.slice(0, 8) },
    integrity,
    issues,
    note: "This is a checkup of the repository's health, not a judgement of any person. Every result is drawn from the append-only audit log and shown with what it means.",
  };
}

// Everything buildIssues needs, in one round trip. Deliberately reads only the
// audit spine — rendering the dashboard must not cost a GitHub call per repo.
async function remediationContext(pool: Pool, repo: string, windowDays: number, mode: RepoMode, defaultBranch?: string) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT event_type FROM audit_events
         WHERE repo = $1 AND event_type IN (
           'protection.configured','protection.restored','protection.weakened',
           'exception.protection_weakened','exception.protection_unavailable')
         ORDER BY ts DESC, id DESC LIMIT 1)                                    AS latest_protection,
       (SELECT count(*)::int FROM audit_events
         WHERE repo = $1 AND event_type = 'push.direct_to_default'
           AND ts >= now() - make_interval(days => $2))                        AS direct_pushes,
       -- Direct pushes since protection was last put in place. This is the
       -- number that says whether there is anything left to DO: pushes from
       -- before protection existed are history, and no button can change them.
       (SELECT count(*)::int FROM audit_events e
         WHERE e.repo = $1 AND e.event_type = 'push.direct_to_default'
           AND e.ts >= now() - make_interval(days => $2)
           AND e.ts > coalesce((SELECT max(p.ts) FROM audit_events p
                                 WHERE p.repo = $1
                                   AND p.event_type IN ('protection.configured','protection.restored')),
                               'epoch'::timestamptz))                          AS direct_pushes_since,
       -- An acceptance can be withdrawn, and withdrawing it appends rather
       -- than deletes, so "is this accepted?" is the LATEST of the two events
       -- for that issue, not merely whether an acceptance was ever recorded.
       (SELECT coalesce(array_agg(issue_id), '{}') FROM (
          SELECT DISTINCT ON (payload->>'issueId')
                 payload->>'issueId' AS issue_id, event_type
            FROM audit_events
           WHERE repo = $1 AND event_type IN ('issue.accepted','issue.unaccepted')
             AND payload->>'issueId' IS NOT NULL
           ORDER BY payload->>'issueId', ts DESC, id DESC
        ) latest WHERE event_type = 'issue.accepted')                          AS accepted`,
    [repo, windowDays]
  );
  const row = rows[0] ?? {};
  return {
    repo,
    defaultBranch: defaultBranch ?? "main",
    mode,
    latestProtectionEvent: (row.latest_protection as string | null) ?? null,
    restoreDrift: config.protection.restoreDrift,
    directPushes: Number(row.direct_pushes ?? 0),
    directPushesSinceProtection: Number(row.direct_pushes_since ?? 0),
    protectionInPlace: row.latest_protection === "protection.configured" || row.latest_protection === "protection.restored",
    accepted: new Set<string>(((row.accepted as string[] | null) ?? []).filter(Boolean)),
  };
}

// ── vital: branch protection (latest state, not windowed) ──────────────────
async function protectionVital(pool: Pool, repo: string | null, mode: RepoMode = DEFAULT_MODE): Promise<HealthVital> {
  const base = { id: "protection", label: "Branch protection" };
  if (!repo) {
    return { ...base, status: "unknown", finding: "This chart is clearest for a single repository — add ?repo=owner/name.", prescription: "" };
  }
  // The latest protection event wins — including `protection.restored`, which
  // is the healthy end state after CodeWorthy corrected drift. Reading only
  // configured/weakened would leave a self-healed repo showing "at risk"
  // forever, which is precisely the enforcement story told backwards.
  const { rows } = await pool.query(
    `SELECT event_type FROM audit_events
     WHERE repo = $1 AND event_type IN (
       'protection.configured','protection.restored',
       'protection.weakened','exception.protection_weakened','exception.protection_unavailable'
     )
     ORDER BY ts DESC, id DESC LIMIT 1`,
    [repo]
  );
  const latest = rows[0]?.event_type as string | undefined;
  if (latest === "protection.weakened" || latest === "exception.protection_weakened" || latest === "exception.protection_unavailable") {
    return { ...base, status: "at risk",
      finding: `Branch protection on the default branch was weakened and is not back in place — force-pushes or deletions may now be allowed, and changes can bypass review.`,
      prescription: "Re-enable protection so the default branch requires a reviewed pull request and blocks force-pushes and deletions." };
  }
  if (latest === "protection.restored") {
    // Bypasses are a windowed behavior, not a state — they belong in the
    // finding because "protection is on" and "someone went around it twice
    // last week" are both true and both worth saying.
    const { rows: byp } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE repo = $1 AND event_type = 'exception.protection_bypassed' AND ts >= now() - interval '30 days'`,
      [repo]
    );
    const n = byp[0]?.n ?? 0;
    return { ...base, status: n > 0 ? "watch" : "healthy",
      finding: `The default branch is protected. CodeWorthy put the protection back after it was weakened${n > 0 ? `, and ${n} change(s) were pushed straight to it by an admin override in the last 30 days` : ""}.`,
      prescription: n > 0 ? "Admin overrides are allowed but recorded — check that each one was deliberate." : "Nothing to do — protection is in force and self-correcting." };
  }
  if (latest === "protection.configured") {
    if (mode === "solo") {
      return { ...base, status: "healthy",
        finding: "This repository is in solo mode: you push to the default branch directly, and CodeWorthy reviews each change after it lands. Force-pushes and branch deletion are still blocked.",
        prescription: "Nothing to do. Switch to shared mode when a second person starts landing changes here." };
    }
    return { ...base, status: "healthy",
      finding: "The default branch is protected — changes go through a reviewable pull request, the CodeWorthy check must pass, and force-pushes and deletions are blocked.",
      prescription: "Keep protection on; every change stays reviewable." };
  }
  return { ...base, status: "watch",
    finding: "The default branch isn't protected yet — work can land on it directly, with nothing reviewing it first.",
    prescription: "Turn on branch protection so changes to the default branch go through a pull request." };
}

// ── vital: the merge gate (windowed behavior) ──────────────────────────────
// What the enforcement spine actually DID. A blocked merge is the good outcome
// here — it is the control working — so it reads as healthy, with the count
// shown rather than hidden. What reads as a problem is the gate not answering:
// a change that merged without a verdict is an untested control.
async function mergeGateVital(pool: Pool, repo: string | null, windowDays: number): Promise<HealthVital> {
  const base = { id: "merge_gate", label: "Merge gate" };
  if (!repo) {
    return { ...base, status: "unknown", finding: "Add ?repo=owner/name to see what the gate decided.", prescription: "" };
  }
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE event_type = 'gate.evaluated')                                  AS evaluated,
       count(*) FILTER (WHERE event_type = 'gate.evaluated' AND payload->>'decision' = 'blocked') AS blocked,
       count(*) FILTER (WHERE event_type = 'exception.gate_unavailable')                       AS unavailable
     FROM audit_events
     WHERE repo = $1 AND ts >= now() - make_interval(days => $2)`,
    [repo, windowDays]
  );
  const evaluated = Number(rows[0]?.evaluated ?? 0);
  const blocked = Number(rows[0]?.blocked ?? 0);
  const unavailable = Number(rows[0]?.unavailable ?? 0);

  if (evaluated === 0 && unavailable === 0) {
    return { ...base, status: "unknown", finding: `No pull requests were reviewed in the last ${windowDays} days.`, prescription: "" };
  }
  if (unavailable > 0) {
    return { ...base, status: "watch",
      finding: `The gate reviewed ${evaluated} change(s) and blocked ${blocked}, but ${unavailable} time(s) it couldn't read the change at all and reported "couldn't review" rather than passing it.`,
      prescription: "Check that CodeWorthy still has access to this repository — a change that merges without a verdict was never actually gated." };
  }
  return { ...base, status: "healthy",
    finding: blocked > 0
      ? `The gate reviewed ${evaluated} change(s) and blocked ${blocked} from merging until they were fixed — that's the control doing its job.`
      : `The gate reviewed ${evaluated} change(s) and found nothing blocking. Every one got a recorded verdict before it could merge.`,
    prescription: "Nothing to do — every change is getting a verdict before it can merge." };
}

// ── vital: review discipline (windowed behavior) ───────────────────────────
async function reviewDisciplineVital(
  pool: Pool,
  repo: string | null,
  windowDays: number,
  mode: RepoMode = DEFAULT_MODE
): Promise<HealthVital> {
  const base = { id: "review_discipline", label: "Review discipline" };
  if (!repo) {
    return { ...base, status: "unknown", finding: "Add ?repo=owner/name to see how changes are landing.", prescription: "" };
  }

  // In solo mode a direct push IS the workflow, so counting it as a failure
  // would leave the vital permanently red for doing exactly what the user
  // chose. What matters instead is whether each one actually got reviewed
  // after it landed — an unreviewed change is the real gap, in either mode.
  if (mode === "solo") {
    const { rows } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE event_type = 'push.direct_to_default')                            AS pushes,
         count(*) FILTER (WHERE event_type = 'gate.evaluated' AND payload->>'postMerge' = 'true') AS reviewed
       FROM audit_events
       WHERE repo = $1 AND ts >= now() - make_interval(days => $2)`,
      [repo, windowDays]
    );
    const pushes = Number(rows[0]?.pushes ?? 0);
    const reviewed = Number(rows[0]?.reviewed ?? 0);
    if (pushes === 0) {
      return { ...base, status: "unknown", finding: `No changes tracked in the last ${windowDays} days.`, prescription: "" };
    }
    if (reviewed >= pushes) {
      return { ...base, status: "healthy",
        finding: `${pushes} change(s) went straight to the default branch, as solo mode intends, and CodeWorthy reviewed every one of them after it landed.`,
        prescription: "Nothing to do — every change is getting reviewed, just after the fact rather than before." };
    }
    return { ...base, status: "watch",
      finding: `${pushes} change(s) landed directly and ${pushes - reviewed} of them got no review — CodeWorthy couldn't read the commit.`,
      prescription: "Check that CodeWorthy still has access to this repository, so changes don't land completely unlooked-at." };
  }
  const { rows } = await pool.query(
    `SELECT event_type, count(*)::int AS n FROM audit_events
     WHERE repo = $1 AND ts >= now() - make_interval(days => $2)
     GROUP BY event_type`,
    [repo, windowDays]
  );
  const c: Record<string, number> = {};
  for (const r of rows) c[r.event_type] = r.n;
  const direct = c["push.direct_to_default"] ?? 0;
  const prs = (c["pull_request.opened"] ?? 0) + (c["pull_request.merged"] ?? 0);

  if (direct === 0 && prs === 0) {
    return { ...base, status: "unknown", finding: `No changes tracked in the last ${windowDays} days.`, prescription: "" };
  }
  if (direct === 0) {
    return { ...base, status: "healthy",
      finding: `Changes went through pull requests — each one was reviewable before it landed on the default branch.`,
      prescription: "Keep opening a pull request for each change." };
  }

  // Split the count at the moment protection went on. Without this the vital
  // stays red for a month over changes whose cause was fixed on day one, and a
  // warning that cannot be cleared by fixing the problem is one people learn to
  // ignore.
  const { rows: split } = await pool.query(
    `SELECT count(*)::int AS since FROM audit_events e
      WHERE e.repo = $1 AND e.event_type = 'push.direct_to_default'
        AND e.ts >= now() - make_interval(days => $2)
        AND e.ts > coalesce((SELECT max(p.ts) FROM audit_events p
                              WHERE p.repo = $1
                                AND p.event_type IN ('protection.configured','protection.restored')),
                            'epoch'::timestamptz)`,
    [repo, windowDays]
  );
  const since = Number(split[0]?.since ?? 0);
  const before = direct - since;

  if (since === 0) {
    // Protection is in place and nothing has gone around it. The history stays
    // visible — it is in the record either way — but it is stated as history.
    return { ...base, status: "healthy",
      finding: `${before} change(s) reached the default branch without review before protection was turned on. Nothing has since — every change now goes through a pull request.`,
      prescription: "Nothing to do. Those changes are in the record; the way they happened is closed off." };
  }

  const status: VitalStatus = prs > 0 ? "watch" : "at risk";
  return { ...base, status,
    finding: `${since} change(s) went straight to the default branch with no pull request${before > 0 ? `, on top of ${before} from before protection was on` : ""}${prs > 0 ? `, alongside ${prs} that did go through review` : ""}.`,
    prescription: "These got past protection that is already on, which means an admin override — check each one was deliberate." };
}

// ── vital + section: record integrity (tamper-evidence) ────────────────────
async function integrityVitalAndSection(pool: Pool, deps: HealthDeps): Promise<{ vital: HealthVital; section: HealthReport["integrity"] }> {
  const chain = await verifyAuditChain(pool);
  const anchor = deps.anchor !== undefined ? deps.anchor : makeAnchor(config.anchor);
  const anchorResult = anchor ? await verifyAgainstAnchor(pool, anchor) : ({ status: "no-anchor" as const, detail: "no external anchor configured" });

  const tampered = !chain.intact || anchorResult.status === "tampered";
  const ok = !tampered;

  let vital: HealthVital;
  if (tampered) {
    const why = !chain.intact
      ? `the change log was altered (a ${chain.reason} break at entry ${chain.brokenAtSeq})`
      : `the externally-anchored record no longer matches (${anchorResult.detail})`;
    vital = { id: "integrity", label: "Record integrity", status: "at risk",
      finding: `Tamper check FAILED — ${why}. The change history should be treated as untrustworthy until reviewed.`,
      prescription: "Investigate who has write access to the database; the audit log is append-only by design and should never fail this check." };
  } else {
    const anchored = anchorResult.status === "consistent" ? " and matches its external write-once anchor" : "";
    vital = { id: "integrity", label: "Record integrity", status: "healthy",
      finding: `The change log verifies intact${anchored} — ${chain.checked} entr${chain.checked === 1 ? "y" : "ies"} checked. This is the change-control evidence a SOC 2 auditor asks for.`,
      prescription: anchorResult.status === "no-anchor" ? "Configure a write-once anchor (S3 Object Lock) to make integrity provable even against an insider." : "Nothing to do — the record is verifiably untampered." };
  }

  const section: HealthReport["integrity"] = {
    ok,
    headline: ok ? "Verified — the record hasn't been tampered with." : "Failed — the record may have been altered.",
    chain: chain.intact ? `intact (${chain.checked} entries)` : `broken at entry ${chain.brokenAtSeq} (${chain.reason})`,
    anchor: anchorResult.status,
  };
  return { vital, section };
}
