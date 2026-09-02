// The approver, wired up: read the reviewer's verdict, decide, act, record.
//
// Sequence, and why this order:
//   1. Read CodeWorthy's verdict for THIS exact commit, from the audit spine.
//      The spine — not the check run — because the spine is the record we
//      already treat as evidence, and because it carries the finding ids the
//      waiver mechanism needs.
//   2. Read the pull request's comments for human waivers.
//   3. Decide (approver/decide.ts — pure, tested).
//   4. Act: submit an approving review, or a plain comment saying what is still
//      outstanding. Never a merge; the approver has no capability to merge.
//   5. Record it, either way. A declined approval is as much evidence of a
//      working control as a granted one — arguably more.
import type { Pool } from "pg";
import { config } from "../config.js";
import { appendAuditEvent } from "../audit/audit.js";
import { approverClientFor, type ApproverClient } from "./client.js";
import { decide, parseWaivers, type Decision, type GateVerdict, type StrictOpinion } from "./decide.js";

export const APPROVER_MARKER = "<!-- codeworthy-approver -->";

export interface ApproveContext {
  repo: string;
  number: number;
  headSha: string;
  author: string | null;
  installationId: number | null;
}

export interface ApproveOutcome {
  action: Decision["action"] | "unavailable";
  reason: string;
  posted: boolean;
}

/** CodeWorthy's verdict for one commit, read back out of the spine. */
export async function verdictFor(pool: Pool, repo: string, number: number, headSha: string): Promise<GateVerdict | null> {
  const { rows } = await pool.query(
    `SELECT payload FROM audit_events
      WHERE repo = $1 AND event_type = 'gate.evaluated'
        AND (payload->>'number')::bigint = $2
        AND payload->>'headSha' = $3
      ORDER BY ts DESC, id DESC LIMIT 1`,
    [repo, number, headSha]
  );
  const payload = rows[0]?.payload as
    | { decision?: string; headSha?: string; findings?: Array<{ id: string; severity: string; file: string | null }> }
    | undefined;
  if (!payload?.decision) return null;
  return {
    headSha: payload.headSha ?? headSha,
    decision: payload.decision as GateVerdict["decision"],
    blocking: (payload.findings ?? [])
      .filter((f) => f.severity === "gate")
      .map((f) => ({ id: f.id, file: f.file ?? null })),
  };
}

/** Have we already posted this same decision for this commit? */
async function alreadyDecided(pool: Pool, repo: string, number: number, headSha: string, action: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM audit_events
      WHERE repo = $1 AND event_type IN ('approval.granted','approval.declined')
        AND (payload->>'number')::bigint = $2
        AND payload->>'headSha' = $3
        AND payload->>'action' = $4
      LIMIT 1`,
    [repo, number, headSha, action]
  );
  return (rowCount ?? 0) > 0;
}

export interface ApproveDeps {
  client?: ApproverClient | null; // injected in tests
  strictOpinion?: (files: unknown) => Promise<StrictOpinion>; // injected; real one is the LLM pass
}

export async function runApprover(pool: Pool, ctx: ApproveContext, deps: ApproveDeps = {}): Promise<ApproveOutcome> {
  const client = deps.client !== undefined ? deps.client : await approverClientFor(ctx.repo);
  // No approver configured or not installed here: it abstains, silently and
  // harmlessly. Protection only ever requires an approval when an approver
  // exists (see enforce.ts approvalRequired), so nothing is left unmergeable.
  if (!client) return { action: "unavailable", reason: "no approver installed on this repository", posted: false };

  const approverLogin = await client.whoAmI();
  const verdict = await verdictFor(pool, ctx.repo, ctx.number, ctx.headSha);
  const waivers = parseWaivers((await client.listIssueComments(ctx.repo, ctx.number)) as Parameters<typeof parseWaivers>[0]);

  // STRICT: a genuinely independent read of the diff, formed before knowing
  // whether the base rules would have approved — so it is a second opinion
  // rather than a rubber stamp with extra steps.
  let strict: StrictOpinion | null = null;
  if (config.approver.strict && deps.strictOpinion) {
    try {
      strict = await deps.strictOpinion(await client.getPullRequestFiles(ctx.repo, ctx.number));
    } catch {
      // Can't form an opinion => withhold approval rather than approve without
      // the check the operator explicitly asked for.
      strict = { ok: false, summary: "the independent second review could not be completed, so this needs a human." };
    }
  }

  const decision = decide({ headSha: ctx.headSha, verdict, waivers, strict, approverLogin });

  // Abstaining is not an event: nothing happened, and the spine records what
  // happened. It will decide again when the review lands.
  if (decision.action === "abstain") return { action: "abstain", reason: decision.reason, posted: false };

  if (await alreadyDecided(pool, ctx.repo, ctx.number, ctx.headSha, decision.action)) {
    return { action: decision.action, reason: decision.reason, posted: false };
  }

  let posted = false;
  try {
    await client.submitReview(ctx.repo, ctx.number, {
      event: decision.action === "approve" ? "APPROVE" : "COMMENT",
      body: renderReview(decision, ctx),
      commitId: ctx.headSha,
    });
    posted = true;
  } catch {
    // The record still gets written. An approval that failed to post is a fact
    // worth keeping — it explains why a PR sat unapproved.
  }

  await appendAuditEvent(pool, {
    installationId: ctx.installationId,
    repo: ctx.repo,
    eventType: decision.action === "approve" ? "approval.granted" : "approval.declined",
    actor: approverLogin,
    payload: {
      number: ctx.number,
      headSha: ctx.headSha,
      action: decision.action,
      author: ctx.author,
      posted,
      strict: config.approver.strict,
      unaddressed: decision.unaddressed,
      waivers: decision.accepted.map((w) => ({ findingId: w.findingId, by: w.by, reason: w.reason })),
    },
    plainEnglish:
      decision.action === "approve"
        ? `${approverLogin} approved PR #${ctx.number} in ${ctx.repo}. ${decision.reason} The approver is a separate identity from the reviewer — it checks that CodeWorthy's findings were dealt with, and it can refuse.`
        : `${approverLogin} declined to approve PR #${ctx.number} in ${ctx.repo}. ${decision.reason}`,
  });

  return { action: decision.action, reason: decision.reason, posted };
}

function renderReview(d: Decision, ctx: ApproveContext): string {
  const lines = [APPROVER_MARKER];
  if (d.action === "approve") {
    lines.push("## ✅ Approved by the CodeWorthy approver", "", d.reason, "");
    if (d.accepted.length) {
      lines.push("**Waived, with reasons given:**", "");
      for (const w of d.accepted) lines.push(`- \`${w.findingId}\` — ${w.reason} _(waived by @${w.by})_`);
      lines.push("");
    }
  } else {
    lines.push("## ⛔ Not approved", "", d.reason, "");
    if (d.unaddressed.length) {
      lines.push("**Still outstanding:**", "");
      for (const f of d.unaddressed) lines.push(`- \`${f.id}\`${f.file ? ` — \`${f.file}\`` : ""}`);
      lines.push(
        "",
        "Either fix these, or waive one with a reason by commenting:",
        "",
        "```",
        `@codeworthy waive ${d.unaddressed[0]!.id}: why this is acceptable here`,
        "```",
        "",
        "_A waiver has to come from a person and has to say why. The reviewer and the approver can't waive their own findings — a control that can excuse itself isn't a control._"
      );
    }
  }
  lines.push(
    "",
    "---",
    `_I'm a separate app from the CodeWorthy reviewer, with my own credentials. I check whether the reviewer's blocking findings were dealt with on \`${ctx.headSha.slice(0, 7)}\` — I don't merge, and I can't change your settings._`
  );
  return lines.join("\n");
}
