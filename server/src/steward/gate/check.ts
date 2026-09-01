// The gate, wired to GitHub: read the change, decide, and REPORT THE VERDICT AS
// THE REQUIRED STATUS CHECK. This is the piece that turns CodeWorthy from a
// thing that describes branch protection into the thing branch protection
// enforces.
//
// The chain, end to end:
//   protection/rulesets requires the check named STEWARD_CHECK
//     -> this module is the only thing that ever posts that check
//        -> a GATE finding posts conclusion "failure"
//           -> GitHub blocks the merge button.
//
// Because that chain exists, this module has one hard obligation: on every head
// commit of every open PR it must post a conclusion. A gate that stays silent
// doesn't "fail open" — it leaves the required check pending and blocks the
// repo forever. So every failure path here still posts a conclusion (`neutral`
// with the reason), and never leaves the check unreported.
//
// It still never merges. It posts a check and a comment; a human merges.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { appendAuditEvent } from "../../audit/audit.js";
import type { GitHubClient } from "../../github/client.js";
import { DEFAULT_CONFIG, type StewardConfig } from "../stewardConfig.js";
import { STEWARD_CHECK } from "../protection.js";
import {
  parseCheckRuns,
  parseCommitSubjects,
  parsePullRequestFiles,
  reviewChangeSet,
  type Finding,
  type GateResult,
} from "./findings.js";

export const GATE_MARKER = "<!-- codeworthy-gate -->";

export interface GateContext {
  repo: string;
  number: number;
  headSha: string;
  author: string | null;
  installationId: number | null;
  config?: StewardConfig;
  /** Link shown on the check run; defaults to none. */
  detailsUrl?: string | null;
}

export interface GateOutcome {
  decision: GateResult["decision"] | "unavailable";
  findingCount: number;
  checkPosted: boolean;
  commented: boolean;
  /** Set when nothing was re-posted because the verdict is unchanged. */
  skipped?: "unchanged";
}

/** Stable fingerprint of a verdict: same diff + same checks => same string. */
export function verdictFingerprint(result: Pick<GateResult, "decision" | "findings">): string {
  const ids = result.findings.map((f) => `${f.severity}:${f.id}:${f.file ?? ""}`).sort();
  return createHash("sha256").update(`${result.decision}|${ids.join(",")}`, "utf8").digest("hex").slice(0, 16);
}

/** Has this exact verdict already been posted for this PR at this commit? */
async function alreadyPosted(pool: Pool, repo: string, number: number, headSha: string, fingerprint: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM audit_events
      WHERE repo = $1 AND event_type = 'gate.evaluated'
        AND (payload->>'number')::bigint = $2
        AND payload->>'headSha' = $3
        AND payload->>'fingerprint' = $4
      LIMIT 1`,
    [repo, number, headSha, fingerprint]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function runGate(client: GitHubClient, pool: Pool, ctx: GateContext): Promise<GateOutcome> {
  const config = ctx.config ?? DEFAULT_CONFIG;

  // Read the change. If GitHub won't answer, we still owe the check a
  // conclusion — see the header note about never leaving it pending.
  let result: GateResult;
  try {
    const [filesRaw, commitsRaw, checksRaw] = await Promise.all([
      client.getPullRequestFiles(ctx.repo, ctx.number),
      client.listPullRequestCommits(ctx.repo, ctx.number),
      client.listCheckRunsForRef(ctx.repo, ctx.headSha),
    ]);
    result = reviewChangeSet(
      {
        files: parsePullRequestFiles(filesRaw),
        commitSubjects: parseCommitSubjects(commitsRaw),
        checks: parseCheckRuns(checksRaw, STEWARD_CHECK),
      },
      config
    );
  } catch (err) {
    return reportUnavailable(client, pool, ctx, err);
  }

  const fingerprint = verdictFingerprint(result);
  if (await alreadyPosted(pool, ctx.repo, ctx.number, ctx.headSha, fingerprint)) {
    return { decision: result.decision, findingCount: result.findings.length, checkPosted: false, commented: false, skipped: "unchanged" };
  }

  // The verdict, as the required check. `failure` is what blocks the merge.
  const checkPosted = await postCheck(client, ctx, {
    conclusion: result.decision === "blocked" ? "failure" : "success",
    title: checkTitle(result.decision),
    summary: result.summary,
    text: renderCheckText(result),
  });

  // The explanation, as one sticky comment — posted when there's something to
  // say, and updated in place when there isn't, so a fixed PR doesn't keep an
  // outdated "changes requested" note sitting on it.
  const existing = await findOurComment(client, ctx.repo, ctx.number);
  let commented = false;
  if (result.findings.length > 0 || existing != null) {
    const body = renderComment(result, ctx.headSha);
    try {
      if (existing != null) await client.updateIssueComment(ctx.repo, existing, body);
      else await client.createReviewComment(ctx.repo, ctx.number, body);
      commented = true;
    } catch {
      /* the check is the enforcement; a comment failure must not lose the verdict */
    }
  }

  await appendAuditEvent(pool, {
    installationId: ctx.installationId,
    repo: ctx.repo,
    eventType: "gate.evaluated",
    actor: "codeworthy-steward",
    payload: {
      number: ctx.number,
      headSha: ctx.headSha,
      author: ctx.author,
      decision: result.decision,
      fingerprint,
      checkName: STEWARD_CHECK,
      checkPosted,
      filesChanged: result.filesChanged,
      addedLines: result.addedLines,
      findings: result.findings.map((f) => ({ id: f.id, severity: f.severity, file: f.file })),
    },
    plainEnglish: plainEnglishFor(result, ctx),
  });

  return { decision: result.decision, findingCount: result.findings.length, checkPosted, commented };
}

// Post (or update in place) OUR check run on this commit. Update-in-place keeps
// one authoritative result per commit instead of a pile of stale ones.
async function postCheck(
  client: GitHubClient,
  ctx: GateContext,
  o: { conclusion: string; title: string; summary: string; text: string }
): Promise<boolean> {
  const payload = {
    name: STEWARD_CHECK,
    headSha: ctx.headSha,
    conclusion: o.conclusion,
    title: o.title,
    summary: o.summary,
    text: o.text,
    detailsUrl: ctx.detailsUrl ?? null,
  };
  try {
    const existing = await findOurCheckRun(client, ctx.repo, ctx.headSha);
    if (existing != null) await client.updateCheckRun(ctx.repo, existing, payload);
    else await client.createCheckRun(ctx.repo, payload);
    return true;
  } catch {
    // Last resort: try a plain create. If that fails too, the caller records
    // checkPosted:false and the drift/reconcile pass will notice.
    try {
      await client.createCheckRun(ctx.repo, payload);
      return true;
    } catch {
      return false;
    }
  }
}

// GitHub wouldn't give us the diff. Post `neutral` — visibly "we didn't judge
// this", never a silent pending that blocks the repo, and never a false green.
async function reportUnavailable(client: GitHubClient, pool: Pool, ctx: GateContext, err: unknown): Promise<GateOutcome> {
  const reason = err instanceof Error ? err.message : String(err);
  const checkPosted = await postCheck(client, ctx, {
    conclusion: "neutral",
    title: "CodeWorthy couldn't review this change",
    summary: "The review didn't run, so this is neither a pass nor a block — a human should look at this diff.",
    text: `CodeWorthy couldn't read this pull request from GitHub, so it has no verdict to give.\n\n\`\`\`\n${reason}\n\`\`\`\n\nThis check is reported as neutral on purpose: it will not silently block your repository, and it will not pretend the change was reviewed.`,
  });
  await appendAuditEvent(pool, {
    installationId: ctx.installationId,
    repo: ctx.repo,
    eventType: "exception.gate_unavailable",
    actor: "codeworthy-steward",
    payload: { number: ctx.number, headSha: ctx.headSha, reason, checkPosted },
    plainEnglish: `Exception: CodeWorthy could not review PR #${ctx.number} in ${ctx.repo} — ${reason}. The check was reported as "couldn't review" rather than passing or blocking, so nothing was approved by default.`,
  });
  return { decision: "unavailable", findingCount: 0, checkPosted, commented: false };
}

const checkTitle = (d: GateResult["decision"]) =>
  d === "blocked" ? "Changes requested — this can't merge yet"
    : d === "advise" ? "No blockers — a few things worth a look"
      : "Looks good to merge";

function renderCheckText(r: GateResult): string {
  const lines: string[] = [];
  const gates = r.findings.filter((f) => f.severity === "gate");
  const advs = r.findings.filter((f) => f.severity === "advise");
  if (gates.length) {
    lines.push("## Must fix before merge", "");
    for (const f of gates) lines.push(bullet(f), "");
  }
  if (advs.length) {
    lines.push("## Worth considering", "");
    for (const f of advs) lines.push(bullet(f), "");
  }
  if (!r.findings.length) lines.push("Nothing blocking and nothing to flag on this diff.", "");
  lines.push("---", `Reviewed ${r.filesChanged} file(s), ~${r.addedLines} new lines. CodeWorthy gates and advises — it never merges for you.`);
  return lines.join("\n");
}

const bullet = (f: Finding) =>
  `- **${f.file ? `\`${f.file}\` — ` : ""}${f.message}**\n  - _${f.fix}_`;

function renderComment(r: GateResult, headSha: string): string {
  const head = {
    blocked: "### 🔴 CodeWorthy — changes requested",
    advise: "### 🟡 CodeWorthy — a few suggestions",
    clean: "### 🟢 CodeWorthy — looks good to merge",
  }[r.decision];
  const lines = [GATE_MARKER, head, ""];
  if (r.decision === "blocked") {
    lines.push("These are blocking: the **CodeWorthy PR review** check is failing, so the merge button stays disabled until they're fixed.", "");
  } else if (r.decision === "clean") {
    lines.push("Nothing blocking and no concerns on this diff. The check is green. ✅", "");
  } else {
    lines.push("Nothing blocking — the check is green. These are for you to judge.", "");
  }
  const gates = r.findings.filter((f) => f.severity === "gate");
  const advs = r.findings.filter((f) => f.severity === "advise");
  if (gates.length) {
    lines.push("**Must fix before merge:**", "");
    for (const f of gates) lines.push(`- 🔴 ${f.file ? `\`${f.file}\` — ` : ""}${f.message}`, `  - _${f.fix}_`);
    lines.push("");
  }
  if (advs.length) {
    lines.push("**Worth considering:**", "");
    for (const f of advs) lines.push(`- 🟡 ${f.file ? `\`${f.file}\` — ` : ""}${f.message}`, `  - _${f.fix}_`);
    lines.push("");
  }
  lines.push(
    "---",
    `_Reviewed ${r.filesChanged} file(s), ~${r.addedLines} new lines at \`${headSha.slice(0, 7)}\`. This comment updates in place. CodeWorthy gates and advises — it never merges for you._`
  );
  return lines.join("\n");
}

function plainEnglishFor(r: GateResult, ctx: GateContext): string {
  const where = `PR #${ctx.number} in ${ctx.repo}`;
  if (r.decision === "blocked") {
    const ids = r.findings.filter((f) => f.severity === "gate").map((f) => f.id).join(", ");
    return `CodeWorthy blocked ${where} from merging: the "${STEWARD_CHECK}" check failed on ${ids}. It stays blocked until the change is fixed — CodeWorthy never merges it for anyone.`;
  }
  if (r.decision === "advise") {
    return `CodeWorthy passed ${where} with ${r.findings.length} suggestion(s) — nothing blocking; the human decides.`;
  }
  return `CodeWorthy reviewed ${where} and found nothing to flag — the check passed.`;
}

async function findOurComment(client: GitHubClient, repo: string, number: number): Promise<number | null> {
  try {
    const raw = (await client.listIssueComments(repo, number)) as Array<{ id?: number; body?: string }> | null;
    if (!Array.isArray(raw)) return null;
    for (const c of raw) {
      if (typeof c?.id === "number" && typeof c?.body === "string" && c.body.includes(GATE_MARKER)) return c.id;
    }
  } catch {
    /* not being able to look doesn't stop the check */
  }
  return null;
}

async function findOurCheckRun(client: GitHubClient, repo: string, headSha: string): Promise<number | null> {
  const raw = (await client.listCheckRunsForRef(repo, headSha)) as { check_runs?: Array<{ id?: number; name?: string }> } | null;
  const list = raw?.check_runs;
  if (!Array.isArray(list)) return null;
  for (const c of list) if (c?.name === STEWARD_CHECK && typeof c.id === "number") return c.id;
  return null;
}
