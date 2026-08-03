// The LLM advise tier (M3) — the one place a reasoning model looks at a change.
//
// It ADVISES, NEVER GATES. Structurally: it only ever calls getPullRequestFiles
// (read) and createReviewComment (post one comment). It never touches
// setBranchProtection and never posts the `CodeWorthy PR review` check that
// branch protection requires — so it cannot block a merge even by accident. The
// deterministic gate does the gating; a model finding is advice a human reads.
//
// Every run: (1) discloses the data-flow (the diff leaves the system), (2) posts
// findings that each cite a policy area + file/lines, (3) asks the one-question
// micro-defense, (4) logs an `llm.reviewed` audit event. Off by default; the
// caller only reaches here when the operator AND the repo opted in.
import type { Pool } from "pg";
import { appendAuditEvent } from "../../audit/audit.js";
import type { GitHubClient } from "../../github/client.js";
import type { LlmClient } from "./anthropic.js";
import {
  buildReviewPrompt,
  DATA_FLOW_DISCLOSURE,
  MICRO_DEFENSE_QUESTION,
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

export async function reviewPullRequest(
  client: GitHubClient,
  llm: LlmClient,
  pool: Pool,
  ctx: ReviewContext
): Promise<ReviewOutcome> {
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

  const comment = renderComment(result, prompt.truncated, prompt.filesShown, prompt.filesTotal);
  await client.createReviewComment(ctx.repo, ctx.number, comment);

  await appendAuditEvent(pool, {
    installationId: ctx.installationId,
    repo: ctx.repo,
    eventType: "llm.reviewed",
    actor: "codeworthy-steward",
    payload: { number: ctx.number, headSha: ctx.headSha, findingCount: result.findings.length, truncated: prompt.truncated },
    plainEnglish:
      result.findings.length === 0
        ? `CodeWorthy's AI review of PR #${ctx.number} in ${ctx.repo} found nothing to flag — advice only, nothing was blocked.`
        : `CodeWorthy's AI review of PR #${ctx.number} in ${ctx.repo} left ${result.findings.length} advisory note(s) — advice only, nothing was blocked.`,
  });

  return { posted: true, findingCount: result.findings.length, truncated: prompt.truncated };
}

// One comment. Advisory framing up top and bottom so it can never read as a
// verdict; every finding cites where; the micro-defense question closes it.
function renderComment(r: ReviewResult, truncated: boolean, shown: number, total: number): string {
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
    `_${DATA_FLOW_DISCLOSURE}_`
  );

  return lines.join("\n");
}
