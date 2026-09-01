// The deterministic gate — the enforcement brain, server-side.
//
// This is the same review `enforcement/pr-review.mjs` performs in a GitHub
// Action, lifted to a pure function over a normalized change set so the hosted
// App can run it from the webhook and report the result as the required status
// check. No network, no filesystem, no LLM: given the same diff it always
// returns the same findings, which is what makes it defensible as a control.
//
// Severity is policy, not code: every finding carries a default severity, and
// the repo's `.steward.yml` can raise it to `gate`, lower it to `advise`, or
// turn it `off`. GATE findings fail the check; branch protection turns a failed
// check into a blocked merge. That chain — finding → check → protection — is
// the whole enforcement spine.
//
// It still never merges. It reports a conclusion; a human merges.
import type { StewardConfig } from "../stewardConfig.js";
import { SECRET_PATTERNS } from "./patterns.js";

export type Severity = "gate" | "advise";
export type Decision = "blocked" | "advise" | "clean";

export interface Finding {
  id: string;
  severity: Severity;
  file: string | null;
  message: string;
  fix: string;
}

/** One changed file, normalized from GitHub's pull-request files API. */
export interface ChangedFile {
  filename: string;
  status: string; // added | modified | removed | renamed | ...
  additions: number;
  addedLines: string[]; // the "+" lines of the patch, without the marker
}

/** One check run GitHub reported on the head commit (ours excluded upstream). */
export interface CheckState {
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | neutral | cancelled | ...
}

export interface ChangeSet {
  files: ChangedFile[];
  commitSubjects: string[];
  checks: CheckState[];
}

export interface GateResult {
  decision: Decision;
  findings: Finding[];
  filesChanged: number;
  addedLines: number;
  /** One-line summary for the check-run output and the audit sentence. */
  summary: string;
}

const isSource = (f: string) =>
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|rs|php)$/.test(f) && !/node_modules|\/dist\/|\.min\./.test(f);
const isTest = (f: string) => /(\.|\/)(test|spec)\.|(^|\/)(tests?|__tests__)\//i.test(f);

// A check that reported one of these is red. `cancelled`, `skipped`, `neutral`
// and `stale` are deliberately NOT failures — a cancelled job is an unknown, and
// gating on unknowns is how a guardrail becomes something people rip out.
const RED = new Set(["failure", "timed_out", "action_required"]);

/** Does this changed path sit under one of the repo's protected paths? */
export function underProtectedPath(file: string, protectedPaths: string[]): string | null {
  for (const raw of protectedPaths) {
    const p = raw.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!p) continue;
    if (file === p || file.startsWith(`${p}/`)) return raw;
  }
  return null;
}

/**
 * Review a change set. Pure: same input, same findings, every time.
 *
 * `config` supplies the repo's gate levels; omit it and the built-in defaults
 * apply (secrets, destructive migrations and committed dependencies gate).
 */
export function reviewChangeSet(change: ChangeSet, config?: StewardConfig): GateResult {
  const findings: Finding[] = [];
  const levels = config?.gates;
  const protectedPaths = config?.protectedPaths ?? [];

  // `level` resolves a finding's configured severity. "off" drops it entirely.
  const add = (
    level: "gate" | "advise" | "off",
    id: string,
    file: string | null,
    message: string,
    fix: string
  ) => {
    if (level === "off") return;
    findings.push({ id, severity: level, file, message, fix });
  };
  const secretsLevel = levels?.secrets ?? "gate";
  const migrationLevel = levels?.destructiveMigration ?? "gate";
  const depsLevel = levels?.committedDependencies ?? "gate";

  // ── security ───────────────────────────────────────────────────────────────
  // A secret introduced by this change. Highest-cost, least-reversible mistake:
  // once it is in the history, it is leaked whether or not the PR merges.
  for (const f of change.files) {
    if (/package-lock|\.min\.|\.map$/.test(f.filename)) continue;
    let flagged = false;
    for (const line of f.addedLines) {
      if (flagged) break;
      for (const [re, what] of SECRET_PATTERNS) {
        if (re.test(line)) {
          add(
            secretsLevel,
            "secret_introduced",
            f.filename,
            `This change adds what looks like a ${what}.`,
            "Remove it, rotate it (assume it's already leaked), and read it from an environment variable instead."
          );
          flagged = true;
          break;
        }
      }
    }
  }
  for (const f of change.files) {
    if (f.status === "added" && /(^|\/)\.env(\.[^e]|$)/.test(f.filename)) {
      add(secretsLevel, "env_committed", f.filename, "This change adds a .env file.",
        "Secrets don't belong in git — add .env to .gitignore and keep the values in the environment.");
    }
    if (/(^|\/)node_modules\//.test(f.filename)) {
      add(depsLevel, "node_modules_committed", f.filename, "This change commits files under node_modules.",
        "node_modules should be gitignored, not committed — remove it and add it to .gitignore.");
    }
  }

  // ── data safety ────────────────────────────────────────────────────────────
  for (const f of change.files) {
    if (!/\.sql$|migrations?\//i.test(f.filename)) continue;
    for (const line of f.addedLines) {
      if (/\bDROP\s+(TABLE|COLUMN)\b/i.test(line)) {
        add(migrationLevel, "destructive_migration", f.filename,
          "This migration drops a table or column — that permanently deletes data.",
          "If you must, do it in stages (stop writing to it, deploy, then drop later) and make sure it's backed up.");
      } else if (/\bADD\s+COLUMN\b[^;]*\bNOT\s+NULL\b(?![^;]*DEFAULT)/i.test(line)) {
        add("advise", "nonnull_no_default", f.filename,
          "Adding a NOT NULL column without a default will fail if the table already has rows.",
          "Add a default, or backfill the column first, then add the constraint.");
      }
    }
  }

  // ── protected paths ────────────────────────────────────────────────────────
  // Paths the repo declared as needing a deliberate decision. Gating them is the
  // point of declaring them; an admin can still bypass, and that bypass is
  // logged as an exception rather than being silently impossible.
  for (const f of change.files) {
    const hit = underProtectedPath(f.filename, protectedPaths);
    if (hit) {
      add("gate", "protected_path", f.filename,
        `This change touches \`${hit}\`, which this repo marked as protected.`,
        "Protected paths need a deliberate decision — have someone who knows this area confirm the change, or take it out of this PR.");
    }
  }

  // ── tested ─────────────────────────────────────────────────────────────────
  // The repo's OWN checks, on this exact commit. Merging on red is the single
  // most common way an AI-built repo ships a break, and it is the one thing a
  // reporting tool can only complain about after the fact.
  const red = change.checks.filter((c) => c.status === "completed" && c.conclusion != null && RED.has(c.conclusion));
  if (red.length) {
    const names = red.map((c) => c.name).join(", ");
    add("gate", "merge_on_red", null,
      `This repo's own checks are failing on this commit: ${names}.`,
      "Fix what's failing, or if the check itself is broken, fix the check. Merging on red puts a known-broken commit on your main branch.");
  }

  const touchedSource = change.files.some((f) => isSource(f.filename));
  const touchedTest = change.files.some((f) => isTest(f.filename));
  const completedOthers = change.checks.filter((c) => c.status === "completed");
  if (touchedSource && completedOthers.length === 0) {
    // ADVISE, never GATE: requiring a check a repo does not have would block
    // every merge forever. The cure is to help them add CI, not to brick them.
    add("advise", "no_ci", null,
      "Nothing ran against this change — this repo has no automated checks reporting on the commit.",
      "Add a CI workflow that runs your tests on every pull request. Until then, nothing but a human reading the diff stands between a bug and your main branch.");
  }
  if (touchedSource && !touchedTest) {
    add("advise", "no_test_in_pr", null,
      "This change touches code but adds or updates no tests.",
      "Add a test that would fail without your change — it's how you (and the next person) know it works and stays working.");
  }

  // ── reviewability ──────────────────────────────────────────────────────────
  const addedLines = change.files.reduce((n, f) => n + (f.additions || f.addedLines.length), 0);
  if (change.files.length > 20 || addedLines > 400) {
    add("advise", "large_pr", null,
      `This change is large (${change.files.length} files, ~${addedLines} new lines) — big changes are hard to review and risky to undo.`,
      "Consider splitting it into smaller pull requests, one logical change each.");
  }
  const weak = change.commitSubjects.filter(
    (m) => m.trim().length < 12 || /^(wip|fix|stuff|update|changes|misc|\.)$/i.test(m.trim())
  );
  if (change.commitSubjects.length && weak.length / change.commitSubjects.length > 0.4) {
    add("advise", "weak_messages", null,
      `Several commit messages are vague (${weak.length} of ${change.commitSubjects.length}).`,
      "Write messages that say what changed and why, so the history is readable later.");
  }

  const blocking = findings.filter((f) => f.severity === "gate");
  const decision: Decision = blocking.length ? "blocked" : findings.length ? "advise" : "clean";
  const summary =
    decision === "blocked"
      ? `${blocking.length} thing(s) must be fixed before this can merge.`
      : decision === "advise"
        ? `Nothing blocking. ${findings.length} suggestion(s) for you to judge.`
        : "Nothing blocking and nothing to flag on this diff.";

  return { decision, findings, filesChanged: change.files.length, addedLines, summary };
}

/**
 * Normalize GitHub's `GET /repos/{repo}/pulls/{n}/files` response into the
 * change set the reviewer consumes. GitHub gives a per-file unified `patch`
 * (absent for binaries and very large files) — we read only the added lines.
 */
export function parsePullRequestFiles(raw: unknown): ChangedFile[] {
  if (!Array.isArray(raw)) return [];
  const out: ChangedFile[] = [];
  for (const item of raw) {
    const f = (item ?? {}) as Record<string, unknown>;
    const filename = typeof f.filename === "string" ? f.filename : "";
    if (!filename) continue;
    out.push({
      filename,
      status: typeof f.status === "string" ? f.status : "modified",
      additions: typeof f.additions === "number" ? f.additions : 0,
      addedLines: parsePatchAdditions(typeof f.patch === "string" ? f.patch : null),
    });
  }
  return out;
}

/** The added ("+") lines of a unified patch hunk body, marker stripped. */
export function parsePatchAdditions(patch: string | null): string[] {
  if (!patch) return [];
  const lines: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++")) continue;
    if (line.startsWith("+")) lines.push(line.slice(1));
  }
  return lines;
}

/** Normalize `GET /commits/{ref}/check-runs`, dropping our own check run. */
export function parseCheckRuns(raw: unknown, excludeName: string): CheckState[] {
  const list = (raw as { check_runs?: unknown } | null)?.check_runs;
  if (!Array.isArray(list)) return [];
  const out: CheckState[] = [];
  for (const item of list) {
    const c = (item ?? {}) as Record<string, unknown>;
    const name = typeof c.name === "string" ? c.name : "";
    if (!name || name === excludeName) continue;
    out.push({
      name,
      status: typeof c.status === "string" ? c.status : "completed",
      conclusion: typeof c.conclusion === "string" ? c.conclusion : null,
    });
  }
  return out;
}

/** Commit subjects from `GET /pulls/{n}/commits` (first line of each message). */
export function parseCommitSubjects(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const message = ((item as Record<string, any>)?.commit?.message ?? "") as unknown;
      return typeof message === "string" ? (message.split("\n")[0] ?? "") : "";
    })
    .filter((s) => s.length > 0);
}
