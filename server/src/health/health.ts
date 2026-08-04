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
  generatedAt: string;
  overall: "Healthy" | "Needs attention" | "At risk";
  vitals: HealthVital[];
  activity: { total: number; windowDays: number; alerts: DigestEntry[]; recent: DigestEntry[] };
  integrity: { ok: boolean; headline: string; chain: string; anchor: string };
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
  opts: { repo?: string; windowDays?: number } = {},
  deps: HealthDeps = {}
): Promise<HealthReport> {
  const repo = opts.repo ?? null;
  const windowDays = Math.min(Math.max(opts.windowDays ?? 30, 1), 90);

  const integrityResult = await integrityVitalAndSection(pool, deps);
  const vitals: HealthVital[] = [
    await protectionVital(pool, repo),
    await reviewDisciplineVital(pool, repo, windowDays),
    integrityResult.vital,
  ];
  const integrity = integrityResult.section;

  const overallStatus = worst(vitals.map((v) => v.status));
  const overall = overallStatus === "at risk" ? "At risk" : overallStatus === "watch" ? "Needs attention" : "Healthy";

  const digest = await buildDigest(pool, { repo: repo ?? undefined, periodDays: windowDays });

  return {
    repoFilter: repo,
    generatedAt: new Date().toISOString(),
    overall,
    vitals,
    activity: { total: digest.totalEvents, windowDays, alerts: digest.alerts, recent: digest.timeline.slice(0, 8) },
    integrity,
    note: "This is a checkup of the repository's health, not a judgement of any person. Every result is drawn from the append-only audit log and shown with what it means.",
  };
}

// ── vital: branch protection (latest state, not windowed) ──────────────────
async function protectionVital(pool: Pool, repo: string | null): Promise<HealthVital> {
  const base = { id: "protection", label: "Branch protection" };
  if (!repo) {
    return { ...base, status: "unknown", finding: "This chart is clearest for a single repository — add ?repo=owner/name.", prescription: "" };
  }
  const { rows } = await pool.query(
    `SELECT event_type FROM audit_events
     WHERE repo = $1 AND event_type IN ('protection.configured','protection.weakened')
     ORDER BY ts DESC, id DESC LIMIT 1`,
    [repo]
  );
  const latest = rows[0]?.event_type as string | undefined;
  if (latest === "protection.weakened") {
    return { ...base, status: "at risk",
      finding: `Branch protection on the default branch was weakened — force-pushes or deletions may now be allowed, and changes can bypass review.`,
      prescription: "Re-enable protection so the default branch requires a reviewed pull request and blocks force-pushes and deletions." };
  }
  if (latest === "protection.configured") {
    return { ...base, status: "healthy",
      finding: "The default branch is protected — changes go through a reviewable pull request, and force-pushes and deletions are blocked.",
      prescription: "Keep protection on; every change stays reviewable." };
  }
  return { ...base, status: "watch",
    finding: "The default branch isn't protected yet — work can land on it directly, with nothing reviewing it first.",
    prescription: "Turn on branch protection so changes to the default branch go through a pull request." };
}

// ── vital: review discipline (windowed behavior) ───────────────────────────
async function reviewDisciplineVital(pool: Pool, repo: string | null, windowDays: number): Promise<HealthVital> {
  const base = { id: "review_discipline", label: "Review discipline" };
  if (!repo) {
    return { ...base, status: "unknown", finding: "Add ?repo=owner/name to see how changes are landing.", prescription: "" };
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
  const status: VitalStatus = prs > 0 ? "watch" : "at risk";
  return { ...base, status,
    finding: `${direct} change(s) went straight to the default branch with no pull request in the last ${windowDays} days${prs > 0 ? `, alongside ${prs} that did go through review` : ` — nothing reviewed them first`}.`,
    prescription: "Do your work on a branch and open a pull request; turning on branch protection makes this automatic." };
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
