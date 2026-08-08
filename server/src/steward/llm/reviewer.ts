// The LLM advise tier (M3) — the one place a reasoning model looks at a change.
//
// It ADVISES, NEVER GATES. Structurally: it only ever reads the PR (files,
// comments) and posts/updates ONE comment. It never touches setBranchProtection
// and never posts the `CodeWorthy PR review` check that branch protection
// requires — so it cannot block a merge even by accident. The deterministic
// gate does the gating; a model finding is advice a human reads.
//
// Noise + spend discipline (the failure mode that sinks tools in this
// category — thirty comments on a 400-line PR and the developer stops reading):
//   - ONE sticky comment per PR, updated in place on each push, never a pile.
//   - Same head SHA is never reviewed twice (webhook redeliveries are free).
//   - A per-PR review cap (.steward.yml `llm.max_reviews_per_pr`, default 5);
//     past it the tier goes quiet — the deterministic gate still runs on every
//     push, so safety never degrades, only commentary.
//
// Provenance (generated advice is never unattributed): every run records WHICH
// policy text (POLICY_VERSION), WHICH model, and a hash of the exact prompt in
// the llm.reviewed audit event, alongside the finding facts (area/file/lines).
// The event's plain-language sentence stays deterministic template text — model
// output lands in the payload clearly labeled as model output, so the audit
// spine never seals generated narrative in as if it were a control fact.
//
// Every run also: (1) discloses the data-flow (the diff leaves the system),
// (2) posts findings that each cite a policy area + file/lines, (3) asks the
// one-question micro-defense. Off by default; the caller only reaches here when
// the operator AND the repo opted in.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { appendAuditEvent } from "../../audit/audit.js";
import type { GitHubClient } from "../../github/client.js";
import type { LlmClient } from "./anthropic.js";
import {
  buildReviewPrompt,
  DATA_FLOW_DISCLOSURE,
  MICRO_DEFENSE_QUESTION,
  POLICY_VERSION,
  REVIEW_SCHEMA,
  type PrDiffFile,
} from "./prompt.js";
import { MICRO_DEFENSE_MARKER } from "./microdefense.js";

export const LLM_REVIEW_MARKER = "<!-- codeworthy-ai-review -->";

export interface ReviewContext {
  repo: string;
  number: number;
  title: string | null;
  body: string | null;
  headSha: string | null;
  author: string | null;
  installationId: number | null;
  maxReviewsPerPr?: number; // from .steward.yml; default 5
}

interface Finding {
  area: string;
  title: string;
  file: string;
  lines: string;
  rationale: string;
}
interface ReviewResult {
  summary: string;
  findings: Finding[];
}

export interface ReviewOutcome {
  posted: boolean;
  findingCount: number;
  truncated: boolean;
  // Why nothing was posted, when nothing was: the same head was already
  // reviewed (redelivery/idempotency) or the per-PR cap was reached.
  skipped?: "already_reviewed" | "capped";
}

// Narrow an unknown parsed model response into the shape we post. Defensive:
// structured-output should already conform, but we never trust it blindly.
function coerce(raw: unknown): ReviewResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary : "Review complete.";
  const findings = Array.isArray(o.findings)
    ? o.findings
        .map((f) => f as Record<string, unknown>)
        .filter((f) => f && typeof f.rationale === "string" && typeof f.file === "string")
        .map((f) => ({
          area: String(f.area ?? "General"),
          title: String(f.title ?? "Note"),
          file: String(f.file ?? ""),
          lines: String(f.lines ?? ""),
          rationale: String(f.rationale ?? ""),
        }))
    : [];
  return { summary, findings };
}

// How many times this PR has already been LLM-reviewed, and whether this exact
// head was. One query against the audit spine — the spine is the state store,
// so idempotency needs no extra table and survives restarts/redeliveries.
async function reviewHistory(
  pool: Pool,
  repo: string,
  number: number,
  headSha: string | null
): Promise<{ count: number; sameHead: boolean; capNoted: boolean }> {
  const res = await pool.query(
    `SELECT
       count(*) FILTER (WHERE event_type = 'llm.reviewed')                                        AS reviews,
       count(*) FILTER (WHERE event_type = 'llm.reviewed' AND payload->>'headSha' = $3)           AS same_head,
       count(*) FILTER (WHERE event_type = 'llm.review_capped')                                   AS cap_noted
     FROM audit_events
     WHERE repo = $1 AND (payload->>'number')::bigint = $2
       AND event_type IN ('llm.reviewed', 'llm.review_capped')`,
    [repo, number, headSha ?? ""]
  );
  const row = res.rows[0] ?? {};
  return {
    count: Number(row.reviews ?? 0),
    sameHead: headSha != null && Number(row.same_head ?? 0) > 0,
    capNoted: Number(row.cap_noted ?? 0) > 0,
  };
}

export async function reviewPullRequest(
  client: GitHubClient,
  llm: LlmClient,
  pool: Pool,
  ctx: ReviewContext
): Promise<ReviewOutcome> {
  const maxReviews = ctx.maxReviewsPerPr ?? 5;
  const history = await reviewHistory(pool, ctx.repo, ctx.number, ctx.headSha);

  // Idempotent on redelivery: this exact head was already reviewed. Silent —
  // nothing happened, so the spine (which records what happened) stays quiet.
  if (history.sameHead) return { posted: false, findingCount: 0, truncated: false, skipped: "already_reviewed" };

  // Per-PR cap: past it the advise tier goes quiet for this PR. Noted in the
  // audit log ONCE (not once per push), so the digest can say "AI review paused
  // on this PR" without the spine filling up with skip entries.
  if (history.count >= maxReviews) {
    if (!history.capNoted) {
      await appendAuditEvent(pool, {
        installationId: ctx.installationId,
        repo: ctx.repo,
        eventType: "llm.review_capped",
        actor: "codeworthy-steward",
        payload: { number: ctx.number, headSha: ctx.headSha, maxReviewsPerPr: maxReviews },
        plainEnglish: `CodeWorthy's AI review paused on PR #${ctx.number} in ${ctx.repo} after ${maxReviews} reviews — the safety checks still run on every push; only the AI commentary paused.`,
      });
    }
    return { posted: false, findingCount: 0, truncated: false, skipped: "capped" };
  }

  const files = ((await client.getPullRequestFiles(ctx.repo, ctx.number)) as PrDiffFile[]) ?? [];

  const prompt = buildReviewPrompt({
    repo: ctx.repo,
    number: ctx.number,
    title: ctx.title,
    body: ctx.body,
    files,
  });

  const result = coerce(
    await llm.review({ system: prompt.system, user: prompt.user, schema: REVIEW_SCHEMA })
  );

  // Provenance for this exact run: which policy, which model, which prompt.
  const promptSha = createHash("sha256").update(prompt.system + "\n" + prompt.user, "utf8").digest("hex");
  const provenance = {
    policyVersion: POLICY_VERSION,
    model: llm.model ?? "unknown",
    promptSha256: promptSha,
  };

  const reviewNumber = history.count + 1;
  const comment = renderComment(result, prompt.truncated, prompt.filesShown, prompt.filesTotal, {
    reviewNumber,
    maxReviews,
    headSha: ctx.headSha,
    provenance,
  });

  // ONE sticky comment per PR: update ours in place if it exists, else create.
  // (Ours = carries the marker AND we only ever PATCH by the id we found — the
  // client has no path to a human's comment.)
  const existing = await findOurComment(client, ctx.repo, ctx.number);
  if (existing != null) {
    await client.updateIssueComment(ctx.repo, existing, comment);
  } else {
    await client.createReviewComment(ctx.repo, ctx.number, comment);
  }

  await appendAuditEvent(pool, {
    installationId: ctx.installationId,
    repo: ctx.repo,
    eventType: "llm.reviewed",
    actor: "codeworthy-steward",
    payload: {
      number: ctx.number,
      headSha: ctx.headSha,
      reviewNumber,
      updatedExisting: existing != null,
      findingCount: result.findings.length,
      truncated: prompt.truncated,
      // Finding FACTS (what was advised, where) — the model's prose stays in
      // the comment; the spine keeps the citable skeleton, labeled as advice.
      findings: result.findings.map((f) => ({ area: f.area, title: f.title, file: f.file, lines: f.lines })),
      provenance,
    },
    plainEnglish:
      result.findings.length === 0
        ? `CodeWorthy's AI review of PR #${ctx.number} in ${ctx.repo} found nothing to flag — advice only, nothing was blocked.`
        : `CodeWorthy's AI review of PR #${ctx.number} in ${ctx.repo} left ${result.findings.length} advisory note(s) — advice only, nothing was blocked.`,
  });

  return { posted: true, findingCount: result.findings.length, truncated: prompt.truncated };
}

// Find the id of the comment WE posted earlier on this PR (by marker), or null.
async function findOurComment(client: GitHubClient, repo: string, number: number): Promise<number | null> {
  const raw = (await client.listIssueComments(repo, number)) as Array<{ id?: number; body?: string }> | null;
  if (!Array.isArray(raw)) return null;
  for (const c of raw) {
    if (typeof c?.id === "number" && typeof c?.body === "string" && c.body.includes(LLM_REVIEW_MARKER)) return c.id;
  }
  return null;
}

// One comment. Advisory framing up top and bottom so it can never read as a
// verdict; every finding cites where; the micro-defense question closes it; the
// footer pins review count, commit, policy version, and model — so the advice
// is attributable, not an anonymous verdict from "the AI".
function renderComment(
  r: ReviewResult,
  truncated: boolean,
  shown: number,
  total: number,
  meta: {
    reviewNumber: number;
    maxReviews: number;
    headSha: string | null;
    provenance: { policyVersion: string; model: string };
  }
): string {
  const lines: string[] = [
    LLM_REVIEW_MARKER,
    "## 🧭 CodeWorthy AI review — advice, not a gate",
    "",
    "> This is a second opinion from an AI reviewer. **It doesn't block anything** — it can't merge, can't change your settings, and nothing here stops you from merging. A human (you) owns that call.",
    "",
    `**Read of this change:** ${r.summary}`,
    "",
  ];

  if (r.findings.length === 0) {
    lines.push("✅ Nothing stood out against the review policy. Still your call to merge.");
  } else {
    lines.push(`### ${r.findings.length} thing(s) worth a look`);
    for (const f of r.findings) {
      const where = f.file ? ` — \`${f.file}\`${f.lines ? ` (lines ${f.lines})` : ""}` : "";
      lines.push("", `**[${f.area}] ${f.title}**${where}`, "", f.rationale);
    }
  }

  if (truncated) {
    lines.push("", `_Note: this change was large — I reviewed ${shown} of ${total} file(s) and part of the diff. Findings cover what I saw, not necessarily everything._`);
  }

  lines.push(
    "",
    "---",
    `${MICRO_DEFENSE_MARKER}`,
    "**Before you merge — one question (your answer keeps you owning this change):**",
    "",
    `> ${MICRO_DEFENSE_QUESTION}`,
    "",
    "_Reply in a sentence. It's not graded — it's here so you've thought it through, not merged blind._",
    "",
    "---",
    `_${DATA_FLOW_DISCLOSURE}_`,
    "",
    `_Review ${meta.reviewNumber} of ${meta.maxReviews} for this PR (this comment updates in place${meta.headSha ? `; current commit \`${meta.headSha.slice(0, 7)}\`` : ""}) · policy \`${meta.provenance.policyVersion}\` · model \`${meta.provenance.model}\`_`
  );

  return lines.join("\n");
}
