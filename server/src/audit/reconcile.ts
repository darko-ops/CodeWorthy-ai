// Completeness reconciliation (V1 of docs/validator-build-plan.md).
//
// The hash chain proves the INTEGRITY of what was recorded. This module proves
// something the chain cannot: that nothing happened OUTSIDE the record. It
// enumerates ground truth from the GitHub API, diffs it against the audit
// spine, and appends the result AS A CHAINED AUDIT EVENT — so the completeness
// check is itself tamper-evident, and an auditor sampling from the population
// has a stated, checkable basis for believing the population is whole.
//
// What is reconciled, and how (each claim scoped to the repo's declared
// coverage windows — we never claim completeness for time we weren't watching):
//
//   1. MERGED PULL REQUESTS — identity reconciliation. Every PR GitHub says
//      merged into the default branch during the covered window must have a
//      spine event (change.merged / pull_request.merged) with a matching merge
//      SHA, and vice versa. Squash and rebase merges reconcile via the PR's
//      merge_commit_sha — never commit-graph heuristics.
//   2. MERGE COMMITS on the default branch — any commit with 2+ parents that
//      is neither a reconciled PR merge nor a recorded push head is an
//      unrecorded merge: a change that reached the trunk outside the record.
//   3. DIRECT PUSHES — completeness here is CONTROL-STATE-BASED, and the
//      statement says so: while branch protection is on, out-of-band pushes are
//      structurally blocked, so recorded exceptions are the whole population;
//      if protection was weakened during the window, the statement flags the
//      interval instead of silently claiming completeness. (Commit-level
//      enumeration of non-merge out-of-band commits is deliberately NOT
//      claimed in V1 — an honest stated limit, not a silent one.)
//
// Discrepancies are evidence, not errors: each becomes a reconciliation.gap
// event (capped, then summarized), and the run always ends in a
// reconciliation.completed event carrying the full result.
import type { Pool } from "pg";
import type { GitHubClient } from "../github/client.js";
import { appendAuditEvent } from "./audit.js";
import { coverageFor, type CoverageWindow } from "./coverage.js";

const MAX_PAGES = 10; // per population; hitting the cap is REPORTED, never silent
const PER_PAGE = 100;
const GAP_EVENT_CAP = 20; // individual gap events per run; the rest summarize

export interface ReconcileParams {
  repo: string;
  defaultBranch: string;
  installationId: number | null;
  from: string; // ISO inclusive
  to: string; // ISO exclusive
}

export interface Discrepancy {
  kind: "missing_from_log" | "sha_mismatch" | "missing_from_github" | "unrecorded_merge_commit";
  detail: string;
  number?: number;
  sha?: string;
}

export interface ReconcileResult {
  repo: string;
  from: string;
  to: string;
  coveredIntervals: Array<{ from: string; to: string }>;
  uncoveredIntervals: Array<{ from: string; to: string }>;
  expectedMergedPrs: number; // ground truth, inside covered intervals
  accountedMergedPrs: number;
  outsideCoverageMergedPrs: number; // merged while we weren't watching — declared, not a gap
  discrepancies: Discrepancy[];
  protectionState: "protected" | "weakened_during_window" | "unknown";
  recordedDirectPushes: number;
  truthTruncated: boolean; // a pagination cap was hit — completeness NOT claimed for the overflow
  statement: string; // the plain-language completeness statement
}

// ── interval arithmetic over coverage windows ──────────────────────────────

type Interval = { from: number; to: number };

function clipWindows(fromMs: number, toMs: number, windows: CoverageWindow[]): Interval[] {
  const clipped: Interval[] = [];
  for (const w of windows) {
    const a = Math.max(fromMs, Date.parse(w.coveredFrom));
    const b = Math.min(toMs, w.coveredTo ? Date.parse(w.coveredTo) : toMs);
    if (a < b) clipped.push({ from: a, to: b });
  }
  clipped.sort((x, y) => x.from - y.from);
  // merge overlaps
  const merged: Interval[] = [];
  for (const iv of clipped) {
    const last = merged[merged.length - 1];
    if (last && iv.from <= last.to) last.to = Math.max(last.to, iv.to);
    else merged.push({ ...iv });
  }
  return merged;
}

function complement(fromMs: number, toMs: number, covered: Interval[]): Interval[] {
  const gaps: Interval[] = [];
  let cursor = fromMs;
  for (const iv of covered) {
    if (iv.from > cursor) gaps.push({ from: cursor, to: iv.from });
    cursor = Math.max(cursor, iv.to);
  }
  if (cursor < toMs) gaps.push({ from: cursor, to: toMs });
  return gaps;
}

const inAny = (tMs: number, ivs: Interval[]) => ivs.some((iv) => tMs >= iv.from && tMs < iv.to);
const iso = (ms: number) => new Date(ms).toISOString();

// ── ground truth ───────────────────────────────────────────────────────────

interface TruthPr {
  number: number;
  mergeSha: string | null;
  mergedAt: string;
  author: string | null;
}
interface TruthCommit {
  sha: string;
  parents: number;
  committedAt: string | null;
}

async function fetchMergedPrs(client: GitHubClient, repo: string, base: string, fromMs: number, toMs: number): Promise<{ prs: TruthPr[]; truncated: boolean }> {
  const prs: TruthPr[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = (await client.listPullRequests(repo, {
      state: "closed", base, sort: "updated", direction: "desc",
      per_page: String(PER_PAGE), page: String(page),
    })) as Array<Record<string, any>> | null;
    const items = raw ?? [];
    for (const pr of items) {
      const mergedAt = pr.merged_at ? Date.parse(pr.merged_at) : NaN;
      if (!Number.isNaN(mergedAt) && mergedAt >= fromMs && mergedAt < toMs) {
        prs.push({ number: pr.number, mergeSha: pr.merge_commit_sha ?? null, mergedAt: pr.merged_at, author: pr.user?.login ?? null });
      }
    }
    if (items.length < PER_PAGE) return { prs, truncated };
    // sort=updated desc: once a whole page updated before the window start,
    // everything further back is older still — safe early stop.
    const oldestUpdated = Math.min(...items.map((p) => Date.parse(p.updated_at ?? p.merged_at ?? "")).filter((n) => !Number.isNaN(n)));
    if (Number.isFinite(oldestUpdated) && oldestUpdated < fromMs) return { prs, truncated };
    if (page === MAX_PAGES) truncated = true;
  }
  return { prs, truncated };
}

async function fetchTrunkCommits(client: GitHubClient, repo: string, branch: string, fromIso: string, toIso: string): Promise<{ commits: TruthCommit[]; truncated: boolean }> {
  const commits: TruthCommit[] = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const raw = (await client.listCommits(repo, {
      sha: branch, since: fromIso, until: toIso,
      per_page: String(PER_PAGE), page: String(page),
    })) as Array<Record<string, any>> | null;
    const items = raw ?? [];
    for (const c of items) {
      commits.push({ sha: c.sha, parents: Array.isArray(c.parents) ? c.parents.length : 0, committedAt: c.commit?.committer?.date ?? null });
    }
    if (items.length < PER_PAGE) return { commits, truncated };
    if (page === MAX_PAGES) truncated = true;
  }
  return { commits, truncated };
}

// ── the reconciliation ─────────────────────────────────────────────────────

export async function reconcileRepo(client: GitHubClient, pool: Pool, params: ReconcileParams): Promise<ReconcileResult> {
  const fromMs = Date.parse(params.from);
  const toMs = Date.parse(params.to);
  const windows = await coverageFor(pool, params.repo);
  const covered = clipWindows(fromMs, toMs, windows);
  const uncovered = complement(fromMs, toMs, covered);

  // The spine's view of the window.
  const spine = await pool.query(
    `SELECT event_type, payload FROM audit_events
     WHERE repo = $1 AND ts >= $2 AND ts < $3
       AND event_type IN ('change.merged','pull_request.merged','push.direct_to_default',
                          'exception.force_push','exception.protection_weakened','protection.weakened',
                          'protection.configured')
     ORDER BY id`,
    [params.repo, params.from, params.to]
  );
  const spineMergeByNumber = new Map<number, { mergeSha: string | null }>();
  const spineMergeShas = new Set<string>();
  const pushHeads = new Set<string>();
  let recordedDirectPushes = 0;
  let weakenedInWindow = false;
  let sawProtectionEvent = false;
  for (const row of spine.rows) {
    const p = row.payload ?? {};
    switch (row.event_type) {
      case "change.merged": // richer — wins over the webhook-shape event below
        if (typeof p.number === "number") spineMergeByNumber.set(p.number, { mergeSha: p.mergeSha ?? null });
        if (p.mergeSha) spineMergeShas.add(p.mergeSha);
        break;
      case "pull_request.merged":
        if (typeof p.number === "number" && !spineMergeByNumber.has(p.number)) spineMergeByNumber.set(p.number, { mergeSha: p.mergeSha ?? null });
        if (p.mergeSha) spineMergeShas.add(p.mergeSha);
        break;
      case "push.direct_to_default":
      case "exception.force_push":
        recordedDirectPushes++;
        if (p.head) pushHeads.add(p.head);
        break;
      case "exception.protection_weakened":
      case "protection.weakened":
        weakenedInWindow = true;
        sawProtectionEvent = true;
        break;
      case "protection.configured":
        sawProtectionEvent = true;
        break;
    }
  }

  // Ground truth from GitHub.
  const { prs: truthPrs, truncated: prsTruncated } = await fetchMergedPrs(client, params.repo, params.defaultBranch, fromMs, toMs);
  const { commits, truncated: commitsTruncated } = await fetchTrunkCommits(client, params.repo, params.defaultBranch, params.from, params.to);
  const truthTruncated = prsTruncated || commitsTruncated;
  const truthByNumber = new Map(truthPrs.map((pr) => [pr.number, pr]));
  const truthMergeShas = new Set(truthPrs.map((pr) => pr.mergeSha).filter(Boolean) as string[]);

  // Diff — only inside covered intervals; outside them, findings are declared
  // coverage limits, not discrepancies.
  const discrepancies: Discrepancy[] = [];
  let accounted = 0;
  let outsideCoverage = 0;
  for (const pr of truthPrs) {
    if (!inAny(Date.parse(pr.mergedAt), covered)) { outsideCoverage++; continue; }
    const rec = spineMergeByNumber.get(pr.number);
    if (!rec) {
      discrepancies.push({ kind: "missing_from_log", number: pr.number, sha: pr.mergeSha ?? undefined,
        detail: `PR #${pr.number} merged on GitHub at ${pr.mergedAt} has no event in the log` });
    } else if (rec.mergeSha && pr.mergeSha && rec.mergeSha !== pr.mergeSha) {
      discrepancies.push({ kind: "sha_mismatch", number: pr.number, sha: pr.mergeSha,
        detail: `PR #${pr.number}: the log records merge ${rec.mergeSha.slice(0, 10)} but GitHub reports ${pr.mergeSha.slice(0, 10)}` });
    } else {
      accounted++;
    }
  }
  // Spine claims a merge GitHub doesn't have (only assertable when truth is complete).
  if (!prsTruncated) {
    for (const [number] of spineMergeByNumber) {
      if (!truthByNumber.has(number)) {
        discrepancies.push({ kind: "missing_from_github", number,
          detail: `the log records PR #${number} as merged in this window but GitHub does not report it — history may have been rewritten` });
      }
    }
  }
  // Merge commits on the trunk that nothing accounts for.
  for (const c of commits) {
    if (c.parents < 2) continue;
    if (truthMergeShas.has(c.sha) || spineMergeShas.has(c.sha) || pushHeads.has(c.sha)) continue;
    if (c.committedAt && !inAny(Date.parse(c.committedAt), covered)) continue;
    discrepancies.push({ kind: "unrecorded_merge_commit", sha: c.sha,
      detail: `merge commit ${c.sha.slice(0, 10)} reached ${params.defaultBranch} without a matching PR or recorded push` });
  }

  const protectionState: ReconcileResult["protectionState"] = weakenedInWindow
    ? "weakened_during_window"
    : sawProtectionEvent
      ? "protected"
      : "unknown";

  const result: ReconcileResult = {
    repo: params.repo,
    from: params.from,
    to: params.to,
    coveredIntervals: covered.map((iv) => ({ from: iso(iv.from), to: iso(iv.to) })),
    uncoveredIntervals: uncovered.map((iv) => ({ from: iso(iv.from), to: iso(iv.to) })),
    expectedMergedPrs: truthPrs.length - outsideCoverage,
    accountedMergedPrs: accounted,
    outsideCoverageMergedPrs: outsideCoverage,
    discrepancies,
    protectionState,
    recordedDirectPushes,
    truthTruncated,
    statement: "", // filled below
  };
  result.statement = renderCompletenessStatement(result);

  // The run lands in the chain — first the gaps (individually, capped), then
  // the completed event that carries the whole result.
  for (const d of discrepancies.slice(0, GAP_EVENT_CAP)) {
    await appendAuditEvent(pool, {
      installationId: params.installationId,
      repo: params.repo,
      eventType: "reconciliation.gap",
      actor: "codeworthy-steward",
      payload: { window: { from: params.from, to: params.to }, ...d },
      plainEnglish: `Reconciliation gap in ${params.repo}: ${d.detail}.`,
    });
  }
  await appendAuditEvent(pool, {
    installationId: params.installationId,
    repo: params.repo,
    eventType: "reconciliation.completed",
    actor: "codeworthy-steward",
    payload: {
      ...result,
      gapEventsEmitted: Math.min(discrepancies.length, GAP_EVENT_CAP),
      gapEventsSummarized: Math.max(0, discrepancies.length - GAP_EVENT_CAP),
    },
    plainEnglish: result.statement,
  });

  return result;
}

// The completeness statement — the artifact that turns a log into evidence.
// Every clause is computed above; nothing here is narrative-only.
export function renderCompletenessStatement(r: ReconcileResult): string {
  const period = `${r.from.slice(0, 10)} → ${r.to.slice(0, 10)}`;
  const parts: string[] = [];
  parts.push(
    `Reconciliation for ${r.repo}, ${period}: GitHub reports ${r.expectedMergedPrs} merged pull request(s) in the covered window; the log accounts for ${r.accountedMergedPrs}; ${r.discrepancies.length === 0 ? "0 unexplained discrepancies" : `${r.discrepancies.length} discrepanc${r.discrepancies.length === 1 ? "y" : "ies"} found`}.`
  );
  if (r.protectionState === "protected") {
    parts.push(`Branch protection was on throughout, so out-of-band pushes were blocked; ${r.recordedDirectPushes} recorded direct-push exception(s) are the whole out-of-band population.`);
  } else if (r.protectionState === "weakened_during_window") {
    parts.push(`Branch protection was weakened during this window — out-of-band changes were possible; ${r.recordedDirectPushes} direct push(es) were recorded, and completeness of unrecorded direct commits is NOT claimed for the weakened interval.`);
  } else {
    parts.push(`Branch-protection state during this window is unknown to the log; completeness of direct pushes is not claimed.`);
  }
  if (r.uncoveredIntervals.length > 0) {
    const ivs = r.uncoveredIntervals.map((iv) => `${iv.from.slice(0, 10)}→${iv.to.slice(0, 10)}`).join(", ");
    parts.push(`Not covered (CodeWorthy was not watching): ${ivs}${r.outsideCoverageMergedPrs ? ` — ${r.outsideCoverageMergedPrs} merge(s) fell in uncovered time and are excluded from the claim` : ""}.`);
  }
  if (r.truthTruncated) {
    parts.push(`Ground-truth enumeration hit a pagination cap; completeness is claimed only for what was enumerated.`);
  }
  return parts.join(" ");
}
