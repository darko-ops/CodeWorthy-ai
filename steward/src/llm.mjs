// The AI reviewer — ADVISE ONLY, by policy and by construction.
//
// The decided rule (2026-08-05): the model NEVER gates. Its findings post as
// a COMMENT review, and its check run can only ever conclude "neutral" —
// NEVER_GATE below is frozen and test/doctrine.test.mjs fails the build if a
// failing conclusion becomes reachable. Deterministic checks gate;
// the model coaches. This is grading-autonomy's prove-vs-understand line
// applied to Steward.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const AI_REVIEW_CHECK = "steward/ai-review";
// The only conclusions the AI review check may ever report.
export const NEVER_GATE = Object.freeze({ ok: "neutral", errored: "neutral" });

const MAX_DIFF_BYTES = 60_000;
const MAX_FINDINGS = 8;

export function buildPrompt({ diff, prTitle, prBody }) {
  const policy = readFileSync(join(here, "prompts", "review-policy.md"), "utf8");
  return [
    { role: "system", content: policy },
    {
      role: "user",
      content: [
        `Review this pull request diff. Title: ${prTitle}`,
        prBody ? `Description:\n${prBody.slice(0, 2000)}` : "(no description)",
        "",
        "```diff",
        diff,
        "```",
      ].join("\n"),
    },
  ];
}

export async function callClaude({ messages, env, fetchImpl = fetch }) {
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.STEWARD_LLM_MODEL || "claude-sonnet-5",
      max_tokens: 2000,
      system: messages.find((m) => m.role === "system")?.content,
      messages: messages.filter((m) => m.role !== "system"),
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const json = await res.json();
  return json.content?.map((b) => b.text ?? "").join("") ?? "";
}

// The model must answer with a JSON array of findings; anything unparseable
// degrades to zero findings (never to a block).
export function parseFindings(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f) => f && typeof f.finding === "string" && typeof f.policy_row === "string")
      .slice(0, MAX_FINDINGS)
      .map((f) => ({
        finding: String(f.finding).slice(0, 800),
        policy_row: String(f.policy_row).slice(0, 120),
        evidence: String(f.evidence ?? "").slice(0, 300),
      }));
  } catch {
    return [];
  }
}

export function renderReviewBody(findings) {
  if (findings.length === 0) {
    return "**CodeWorthy Steward — AI review:** nothing to flag against the policy. (Advisory only — a clean pass here is not an approval.)";
  }
  const items = findings
    .map(
      (f, i) =>
        `${i + 1}. ${f.finding}\n   - _policy:_ ${f.policy_row}${f.evidence ? `\n   - _where:_ ${f.evidence}` : ""}`
    )
    .join("\n");
  return [
    "**CodeWorthy Steward — AI review** (advisory only; this never blocks a merge — you own the decision):",
    "",
    items,
    "",
    "_Every point cites the policy row it comes from. Disagree? Say why and merge — that reasoning is exactly what the log should hold._",
  ].join("\n");
}

export async function runAdviseReview({ client, audit, owner, repo, repoFull, installationId, pr, env, fetchImpl = fetch }) {
  let conclusion = NEVER_GATE.ok;
  let findings = [];
  try {
    const diff = await client.getPullDiff(owner, repo, pr.number, MAX_DIFF_BYTES);
    const messages = buildPrompt({ diff, prTitle: pr.title, prBody: pr.body });
    const answer = await callClaude({ messages, env, fetchImpl });
    findings = parseFindings(answer);
    await client.createReview(owner, repo, pr.number, { body: renderReviewBody(findings) });
  } catch (err) {
    conclusion = NEVER_GATE.errored;
    findings = [];
    // An AI failure never becomes the customer's problem: log it, stay quiet.
  }
  await client.createCheckRun(owner, repo, {
    name: AI_REVIEW_CHECK,
    head_sha: pr.head.sha,
    status: "completed",
    conclusion, // structurally: only ever "neutral"
    output: {
      title: findings.length === 0 ? "No advisories" : `${findings.length} advisory note(s)`,
      summary: "Advisory review — never blocks a merge.",
    },
  });
  await audit({
    installationId,
    repo: repoFull,
    actor: "steward",
    eventType: "ai_review_posted",
    payload: { pr: pr.number, findings: findings.length },
    plainEnglish: `Steward's AI reviewer left ${findings.length} advisory note(s) on pull request #${pr.number}. Advisory only — it cannot block a merge.`,
  });
  return { findings: findings.length, conclusion };
}
