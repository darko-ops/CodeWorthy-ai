#!/usr/bin/env node
// The AI senior engineer's PR gate — the enforcement brain.
//
// Reviews the DIFF of a pull request (base...head) and decides, like a senior
// reviewer would: GATE (block the merge), ADVISE (comment, human decides), or
// clean. Deterministic, dependency-free, no network — so it runs in a plain
// GitHub Actions job. Combined with branch protection, a GATE finding blocks
// the merge; ADVISE findings post as review comments.
//
// It NEVER merges, never force-pushes, never rewrites history. It gates and
// advises; the human owns the merge (CodeWorthy's "stay in control" applied to
// the tool itself).
//
// Usage:
//   node enforcement/pr-review.mjs --repo <path> --base <ref> --head <ref> \
//       [--comment out.md] [--audit audit.jsonl] [--json] [--actor <name>]
//
// Exit: 0 = mergeable (clean or advise-only), 2 = blocked (a GATE finding).
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { SECRET_PATTERNS } from "../checkup/secret-patterns.mjs";

const argv = process.argv.slice(2);
const arg = (n, fb) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : fb; };
const has = (n) => argv.includes(`--${n}`);
const repo = arg("repo", ".");
const base = arg("base", "main");
const head = arg("head", "HEAD");
const commentOut = arg("comment", null);
const auditOut = arg("audit", null);
const actor = arg("actor", "unknown");
const asJson = has("json");

const git = (...a) => {
  try { return execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
};
const gitLines = (...a) => git(...a).split("\n").filter(Boolean);

for (const ref of [base, head]) {
  if (!git("rev-parse", "--verify", ref).trim()) { console.error(`pr-review: ref '${ref}' not found`); process.exit(2); }
}
const mergeBase = git("merge-base", base, head).trim() || base;

// ── diff intelligence ──────────────────────────────────────────────────────────
const range = `${mergeBase}..${head}`;
const changed = gitLines("diff", "--name-status", range).map((l) => {
  const [status, ...rest] = l.split("\t"); return { status, file: rest[rest.length - 1] };
});
const addedByFile = (() => {
  const out = {}; let cur = null;
  for (const line of git("diff", "--unified=0", range).split("\n")) {
    const m = line.match(/^\+\+\+ b\/(.+)$/); if (m) { cur = m[1]; out[cur] = []; continue; }
    if (cur && line.startsWith("+") && !line.startsWith("+++")) out[cur].push(line.slice(1));
  }
  return out;
})();
const commitSubjects = gitLines("log", "--no-merges", "--format=%s", range);

const isSource = (f) => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|rs|php)$/.test(f) && !/node_modules|\/dist\/|\.min\./.test(f);
const isTest = (f) => /(\.|\/)(test|spec)\.|(^|\/)(tests?|__tests__)\//i.test(f);

// ── checks ───────────────────────────────────────────────────────────────────
const findings = [];
const gate = (id, file, message, fix) => findings.push({ id, severity: "gate", file, message, fix });
const advise = (id, file, message, fix) => findings.push({ id, severity: "advise", file, message, fix });

// GATE: a secret introduced by this PR
for (const [file, lines] of Object.entries(addedByFile)) {
  if (/package-lock|\.min\.|\.map$/.test(file)) continue;
  for (const l of lines) { for (const [re, what] of SECRET_PATTERNS) if (re.test(l)) { gate("secret_introduced", file, `This PR adds what looks like a ${what}.`, "Remove it, rotate it (assume it's already leaked), and read it from an environment variable instead."); break; } }
}
// GATE: a .env or node_modules added
for (const { status, file } of changed) {
  if (status.startsWith("A") && /(^|\/)\.env(\.[^e]|$)/.test(file)) gate("env_committed", file, "This PR adds a .env file.", "Secrets don't belong in git — add .env to .gitignore and keep values in the environment.");
  if (/(^|\/)node_modules\//.test(file)) gate("node_modules_committed", file, "This PR commits files under node_modules.", "node_modules should be gitignored, not committed — remove it and add it to .gitignore.");
}
// GATE/ADVISE: destructive migration
for (const [file, lines] of Object.entries(addedByFile)) {
  if (!/\.sql$|migrations?\//i.test(file)) continue;
  for (const l of lines) {
    if (/\bDROP\s+(TABLE|COLUMN)\b/i.test(l)) gate("destructive_migration", file, "This migration drops a table or column — that permanently deletes data.", "If you must, do it in stages (stop writing to it, deploy, then drop later) and make sure it's backed up.");
    else if (/\bADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b(?![^;]*DEFAULT)/i.test(l)) advise("nonnull_no_default", file, "Adding a NOT NULL column without a default will fail if the table already has rows.", "Add a default, or backfill the column first, then add the constraint.");
  }
}
// ADVISE: source changed with no test in this PR
const touchedSource = changed.some((c) => isSource(c.file));
const touchedTest = changed.some((c) => isTest(c.file));
if (touchedSource && !touchedTest) advise("no_test_in_pr", null, "This PR changes code but adds or updates no tests.", "Add a test that would fail without your change — it's how you (and the next person) know it works and stays working.");
// ADVISE: large PR
const addedLines = Object.values(addedByFile).reduce((n, a) => n + a.length, 0);
if (changed.length > 20 || addedLines > 400) advise("large_pr", null, `This PR is large (${changed.length} files, ~${addedLines} new lines) — big changes are hard to review and risky to undo.`, "Consider splitting it into smaller PRs, one logical change each.");
// ADVISE: vague commit messages
const weak = commitSubjects.filter((m) => m.trim().length < 12 || /^(wip|fix|stuff|update|changes|misc|\.)$/i.test(m.trim()));
if (commitSubjects.length && weak.length / commitSubjects.length > 0.4) advise("weak_messages", null, `Several commit messages are vague (${weak.length} of ${commitSubjects.length}).`, "Write messages that say what changed and why, so the history is readable later.");

const decision = findings.some((f) => f.severity === "gate") ? "blocked"
  : findings.length ? "advise" : "clean";

// ── outputs ──────────────────────────────────────────────────────────────────
const result = {
  repo, base, head, mergeBase: mergeBase.slice(0, 12), actor,
  generatedAt: new Date().toISOString(),
  decision, filesChanged: changed.length, addedLines,
  findings,
  note: "Reviewed the pull request diff, like a senior engineer would. Blocking findings must be fixed before merge; advisory ones are for you to judge. This tool never merges — you do.",
};

function renderComment(r) {
  const head = { blocked: "### 🔴 CodeWorthy review — changes requested",
    advise: "### 🟡 CodeWorthy review — a few suggestions",
    clean: "### 🟢 CodeWorthy review — looks good to merge" }[r.decision];
  const lines = [head, ""];
  if (r.decision === "clean") lines.push("Nothing blocking and no concerns on this diff. Nice and clean. ✅", "");
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
  lines.push("---", `_Reviewed ${r.filesChanged} file(s), ~${r.addedLines} new lines. CodeWorthy gates and advises — it never merges for you._`);
  return lines.join("\n");
}

const comment = renderComment(result);
if (commentOut) writeFileSync(commentOut, comment + "\n");
if (auditOut) appendFileSync(auditOut, JSON.stringify({
  ts: result.generatedAt, repo, base, head, mergeBase: result.mergeBase, actor,
  decision, findingIds: findings.map((f) => `${f.severity}:${f.id}`),
}) + "\n");

if (asJson) console.log(JSON.stringify(result, null, 2));
else console.log(comment);

process.exit(decision === "blocked" ? 2 : 0);
