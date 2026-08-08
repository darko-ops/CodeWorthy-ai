// Prompt assembly for the LLM advise tier (M3).
//
// The system prompt IS the policy: the model-judgment rows of
// docs/ai-senior-engineer-policy.md and the competency anchors of
// evaluation/rubric.md, distilled and version-controlled here so the reviewer
// is self-contained (no dependency on repo file layout at runtime) and the
// exact rules the model enforces are auditable in the code.
//
// Two invariants are baked into the prompt, not left to the model's goodwill:
//   1. ADVISE, NEVER GATE — the model is told, in the system prompt, that its
//      output is advice a human reads; it cannot block, merge, or change repo
//      settings. Structurally it also can't: the reviewer only ever comments.
//   2. EVERY finding cites evidence — a policy area and the file/lines in the
//      diff. A finding with no cite is not a finding.
import { createHash } from "node:crypto";

// The model-judgment tier of the stewardship policy (the ADVISE rows — the ones
// that genuinely need a reasoning model, not a pattern check).
export const POLICY_ROWS: Array<{ area: string; rule: string }> = [
  { area: "Implementation", rule: "New code duplicates something that already exists — point at the existing helper instead of a second copy." },
  { area: "Systems thinking", rule: "A change alters a shared contract/API shape consumed elsewhere — flag who breaks (\"this response shape is consumed by X\")." },
  { area: "Codebase comprehension", rule: "A file the repo marks do-not-touch is being edited — surface the warning the repo already carries." },
  { area: "Security", rule: "A new route/endpoint is missing the auth its siblings have — \"every other order route checks a key; this one doesn't — intended?\"" },
  { area: "Testing", rule: "Product code changed but nothing tests the new behavior — name what's untested and suggest the shape of a test." },
  { area: "Data safety", rule: "A schema change ships without a migration, or a migration looks risky — the DB won't match the code on deploy." },
  { area: "Git discipline", rule: "One change does several unrelated things — suggest splitting it so each part can be reviewed and reverted on its own." },
  { area: "Deployment judgment", rule: "A change with no obvious rollback path is going toward main — note how they'd undo it if it breaks." },
];

// Competency anchors (distilled from evaluation/rubric.md) — how a senior reads
// a change. Gives the model the *bar*, not just the checklist.
export const RUBRIC_ANCHORS = [
  "Root-cause vs symptom: does the change address why something is wrong, or just quiet the symptom?",
  "Race/scope safety: in-memory or per-process state that a second replica or a restart would defeat is not a real guarantee.",
  "Focused, convention-matching diffs beat sprawling ones; a change that matches the repo's existing patterns is easier to trust.",
  "Test theater: a test that would pass on the OLD code too doesn't prove the fix — value tests that fail before and pass after.",
];

// The one-question micro-defense — a presence prompt, never auto-graded (see
// microdefense.ts). Kept here so the reviewer posts it in the same comment.
export const MICRO_DEFENSE_QUESTION =
  "In one sentence — what does this change do, and what's the one thing most likely to break because of it?";

// Disclosed to the repo owner every time this tier runs: their diff leaves the
// system. The deterministic gate and checkup never call out; only this tier.
export const DATA_FLOW_DISCLOSURE =
  "Heads up: to write this review, the changed lines of this pull request were sent to a third-party AI model (Anthropic). No repository code leaves CodeWorthy except for the diff of an open pull request, and only when you've turned this AI-review tier on. Turn it off any time in .steward.yml (`llm.enabled: false`).";

// The JSON contract the model must return. Structured-output enforced.
export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string", description: "One plain-language sentence a non-engineer understands: is this safe to merge, and why / why-not." },
    findings: {
      type: "array",
      description: "Advisory findings. Empty is a valid, good answer — do not invent findings.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["area", "title", "file", "lines", "rationale"],
        properties: {
          area: { type: "string", description: "The policy area this maps to (e.g. Security, Testing, Implementation)." },
          title: { type: "string", description: "A short, plain-language headline." },
          file: { type: "string", description: "The file in the diff this is about." },
          lines: { type: "string", description: "The line range in the diff, e.g. \"42-48\". Required — a finding must cite where." },
          rationale: { type: "string", description: "Why it matters, in plain language, tied to the cited lines. No jargon." },
        },
      },
    },
  },
};

export interface PrDiffFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string; // unified diff; absent for binary/too-large files
}

export interface ReviewPromptInput {
  repo: string;
  number: number;
  title: string | null;
  body: string | null;
  files: PrDiffFile[];
}

export interface AssembledPrompt {
  system: string;
  user: string;
  truncated: boolean; // true when the diff was capped — surfaced in the comment
  filesShown: number;
  filesTotal: number;
}

// Cap the diff we send: a bound on cost, latency, and how much leaves the
// system. Per-file and total. When we cap, we SAY SO (truncated flag) rather
// than silently review a fraction and imply we saw it all.
const MAX_TOTAL_DIFF_CHARS = 60_000;
const MAX_FILE_DIFF_CHARS = 12_000;

// The system prompt is input-independent — it IS the review policy. Assembled
// once so it can be content-addressed: POLICY_VERSION identifies exactly which
// policy text produced a given review. Change a rule, the version changes.
// Recorded in every llm.reviewed audit event and shown in the posted comment,
// so a review is never an unattributed judgment (the governance requirement:
// every review decision traceable to the standard it applied).
export const SYSTEM_PROMPT: string = [
  "You are CodeWorthy's senior-engineer reviewer for a builder who does not know git deeply.",
  "You ADVISE. You never gate, never block, never merge, never change repository settings — your entire output is advice a human reads and decides on. Deterministic checks do the gating; you do not.",
  "",
  "Review the pull request against this policy (these are the judgment calls a senior engineer would raise — not style nits):",
  POLICY_ROWS.map((r) => `- [${r.area}] ${r.rule}`).join("\n"),
  "",
  "Hold changes to this bar:",
  RUBRIC_ANCHORS.map((a) => `- ${a}`).join("\n"),
  "",
  "Rules for your output:",
  "- Every finding MUST cite the file and line range in the diff it refers to. A finding with no cite is not allowed.",
  "- Map every finding to one of the policy areas above.",
  "- Write for a non-engineer: plain language, no jargon, say why it matters in terms of what could break.",
  "- Be honest about confidence. If the change looks fine, return an empty findings list and say so in the summary. Do not manufacture concerns.",
  "- You see only the diff, not the whole repo — if a concern depends on code you can't see, say that instead of asserting it.",
].join("\n");

// Short content hash of the policy text above. "policy 3f2a9c1b04d7" in a
// comment or audit event pins the exact rules that review applied.
export const POLICY_VERSION: string = createHash("sha256").update(SYSTEM_PROMPT, "utf8").digest("hex").slice(0, 12);

export function buildReviewPrompt(input: ReviewPromptInput): AssembledPrompt {
  const system = SYSTEM_PROMPT;

  // Assemble the user turn: PR context + capped diff.
  let total = 0;
  let truncated = false;
  let filesShown = 0;
  const parts: string[] = [];
  for (const f of input.files) {
    if (total >= MAX_TOTAL_DIFF_CHARS) { truncated = true; break; }
    const header = `\n=== ${f.filename} (${f.status ?? "modified"}, +${f.additions ?? 0}/-${f.deletions ?? 0}) ===\n`;
    let patch = f.patch ?? "(no textual diff — binary or too large to display)";
    if (patch.length > MAX_FILE_DIFF_CHARS) { patch = patch.slice(0, MAX_FILE_DIFF_CHARS) + "\n… (file diff truncated) …"; truncated = true; }
    if (total + header.length + patch.length > MAX_TOTAL_DIFF_CHARS) { truncated = true; break; }
    parts.push(header + patch);
    total += header.length + patch.length;
    filesShown++;
  }
  if (filesShown < input.files.length) truncated = true;

  const user = [
    `Pull request #${input.number} in ${input.repo}`,
    `Title: ${input.title ?? "(no title)"}`,
    `Description: ${input.body?.trim() ? input.body.trim() : "(empty)"}`,
    "",
    `Changed files (${filesShown} of ${input.files.length} shown${truncated ? "; diff was capped" : ""}):`,
    parts.join("\n") || "(no textual diff available)",
    "",
    "Return your review as JSON matching the required schema.",
  ].join("\n");

  return { system, user, truncated, filesShown, filesTotal: input.files.length };
}
