// Merge evidence (V0.2 of docs/validator-build-plan.md) — the control facts an
// auditor tests a change against, captured AT MERGE TIME, when they're cheap
// and unambiguous, instead of reconstructed months later.
//
// For every merged PR this records one `change.merged` event:
//   - who wrote it, who APPROVED it (and when), whether any approval preceded
//     the merge, and whether the only approval was the author's own
//     (self-approval — the segregation-of-duties exception an auditor samples
//     for first);
//   - what the CI checks said on the PR head at merge time;
//   - the merge commit SHA — the join key the whole evidence graph hangs off.
//
// If the checks were red at merge, a first-class `exception.merged_red_checks`
// event is appended too (V0.3): exceptions are evidence, not noise — a control
// is tested partly by how its failures are handled.
//
// Everything here is deterministic reads + template text. Evidence-gathering
// failures are RECORDED, not hidden: if the reviews or checks API call fails,
// the event still lands, with the gap named in `evidenceGaps` — an honest hole
// beats a silently perfect-looking record (ratified invariant #1: the verifier
// recomputes from raw evidence; it can only do that if gaps are visible).
import type { Pool } from "pg";
import { appendAuditEvent } from "../audit/audit.js";
import type { GitHubClient } from "../github/client.js";

export interface MergeContext {
  repo: string;
  number: number;
  installationId: number | null;
  author: string | null; // PR author
  mergedBy: string | null;
  mergedAt: string | null; // ISO from the webhook
  mergeSha: string | null; // pull_request.merge_commit_sha — the join key
  headSha: string | null; // where the checks ran
  base: string | null;
}

interface ReviewLike {
  user?: { login?: string };
  state?: string;
  submitted_at?: string;
}
interface CheckRunLike {
  name?: string;
  conclusion?: string | null;
}

export interface MergeEvidence {
  approvers: Array<{ login: string; submittedAt: string | null }>;
  selfApproved: boolean;
  approvalPrecededMerge: boolean;
  checksAtMerge: Array<{ name: string; conclusion: string | null }>;
  redChecksAtMerge: string[];
  evidenceGaps: string[];
}

const RED = new Set(["failure", "timed_out", "startup_failure", "action_required"]);

// An approver is a reviewer whose LATEST review at-or-before the merge instant
// is APPROVED — a later "changes requested" supersedes an earlier approval,
// and post-merge approvals don't count as pre-merge control operation.
export function computeApprovers(reviews: ReviewLike[], mergedAt: string | null, author: string | null): {
  approvers: Array<{ login: string; submittedAt: string | null }>;
  selfApproved: boolean;
} {
  const mergedMs = mergedAt ? Date.parse(mergedAt) : Number.POSITIVE_INFINITY;
  const latestByUser = new Map<string, ReviewLike>();
  for (const r of reviews) {
    const login = r.user?.login;
    if (!login) continue;
    const at = r.submitted_at ? Date.parse(r.submitted_at) : NaN;
    if (Number.isNaN(at) || at > mergedMs) continue; // outside the merge window
    // COMMENTED reviews neither grant nor revoke approval — skip them.
    const state = (r.state ?? "").toUpperCase();
    if (state !== "APPROVED" && state !== "CHANGES_REQUESTED" && state !== "DISMISSED") continue;
    const prev = latestByUser.get(login);
    const prevAt = prev?.submitted_at ? Date.parse(prev.submitted_at) : -1;
    if (at >= prevAt) latestByUser.set(login, r);
  }
  const approvers = [...latestByUser.entries()]
    .filter(([, r]) => (r.state ?? "").toUpperCase() === "APPROVED")
    .map(([login, r]) => ({ login, submittedAt: r.submitted_at ?? null }))
    .sort((a, b) => a.login.localeCompare(b.login));
  const selfApproved = author != null && approvers.some((a) => a.login === author);
  return { approvers, selfApproved };
}

export async function recordMergeEvidence(
  client: GitHubClient,
  pool: Pool,
  ctx: MergeContext
): Promise<{ auditId: string; evidence: MergeEvidence }> {
  const gaps: string[] = [];

  let reviews: ReviewLike[] = [];
  try {
    reviews = ((await client.listPullRequestReviews(ctx.repo, ctx.number)) as ReviewLike[]) ?? [];
  } catch {
    gaps.push("reviews_unavailable");
  }
  const { approvers, selfApproved } = computeApprovers(reviews, ctx.mergedAt, ctx.author);

  let checks: CheckRunLike[] = [];
  if (ctx.headSha) {
    try {
      const res = (await client.listCheckRunsForRef(ctx.repo, ctx.headSha)) as { check_runs?: CheckRunLike[] };
      checks = res?.check_runs ?? [];
    } catch {
      gaps.push("checks_unavailable");
    }
  } else {
    gaps.push("head_sha_missing");
  }
  const checksAtMerge = checks
    .filter((c) => c.name)
    .map((c) => ({ name: String(c.name), conclusion: c.conclusion ?? null }));
  const redChecksAtMerge = checksAtMerge.filter((c) => c.conclusion && RED.has(c.conclusion)).map((c) => c.name);

  const evidence: MergeEvidence = {
    approvers,
    selfApproved,
    approvalPrecededMerge: approvers.length > 0, // approvers are pre-merge by construction
    checksAtMerge,
    redChecksAtMerge,
    evidenceGaps: gaps,
  };

  // The deterministic sentence: states the control facts, flags the exceptions.
  const who = ctx.mergedBy ?? "someone";
  const approvalPhrase =
    approvers.length === 0
      ? "with NO approving review"
      : `with ${approvers.length} approval${approvers.length === 1 ? "" : "s"} (${approvers.map((a) => a.login).join(", ")})${selfApproved ? " — including the author's own" : ""}`;
  const checksPhrase = gaps.includes("checks_unavailable") || gaps.includes("head_sha_missing")
    ? "check status could not be read"
    : checksAtMerge.length === 0
      ? "no CI checks were configured"
      : redChecksAtMerge.length === 0
        ? `all ${checksAtMerge.length} check${checksAtMerge.length === 1 ? "" : "s"} passing at merge`
        : `${redChecksAtMerge.length} of ${checksAtMerge.length} checks FAILING at merge (${redChecksAtMerge.join(", ")})`;

  const auditId = await appendAuditEvent(pool, {
    installationId: ctx.installationId,
    repo: ctx.repo,
    eventType: "change.merged",
    actor: ctx.mergedBy,
    payload: {
      number: ctx.number,
      mergeSha: ctx.mergeSha,
      headSha: ctx.headSha,
      base: ctx.base,
      author: ctx.author,
      mergedAt: ctx.mergedAt,
      ...evidence,
    },
    plainEnglish: `PR #${ctx.number} in ${ctx.repo} was merged into ${ctx.base ?? "the default branch"} by ${who} ${approvalPhrase}; ${checksPhrase}.`,
  });

  if (redChecksAtMerge.length > 0) {
    await appendAuditEvent(pool, {
      installationId: ctx.installationId,
      repo: ctx.repo,
      eventType: "exception.merged_red_checks",
      actor: ctx.mergedBy,
      payload: { number: ctx.number, mergeSha: ctx.mergeSha, headSha: ctx.headSha, redChecks: redChecksAtMerge },
      plainEnglish: `Exception: PR #${ctx.number} in ${ctx.repo} was merged by ${who} while ${redChecksAtMerge.length === 1 ? "a check was" : "checks were"} failing (${redChecksAtMerge.join(", ")}).`,
    });
  }

  return { auditId, evidence };
}
