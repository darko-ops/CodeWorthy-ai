// A repository's rules: what must be true for a change to land here.
//
// These were only ever expressible in a `.steward.yml` that nothing loaded.
// The parser existed (stewardConfig.ts) and was wired into the gate, but the
// client deliberately has no contents-read capability — the doctrine test bars
// `/contents/` endpoints so the App can never read or write arbitrary files —
// so the file could never actually be fetched. Every repo therefore ran on
// DEFAULT_CONFIG, and the settings were documentation of an intention.
//
// So rules live here instead: set from the dashboard, stored in the audit spine
// the same way the repo mode is. That keeps who changed a rule, when, and to
// what as append-only evidence — which matters more for this product than
// config-in-the-repo would, because "who loosened the secret gate, and when" is
// exactly the question an auditor asks.
//
// MODE IS NOT STORED HERE. It has its own event (repo.mode_set) and its own
// reader, and duplicating it would create two sources of truth for the single
// setting that decides what "protected" even means.
import type { Pool } from "pg";
import { appendAuditEvent } from "../audit/audit.js";
import { DEFAULT_CONFIG, type StewardConfig } from "./stewardConfig.js";
import type { RulesetShape } from "./rulesets.js";
import type { RepoMode } from "./repoMode.js";

export type GateLevel = "gate" | "advise" | "off";

export interface RepoRules {
  /** What a finding does: block the merge, comment, or nothing. */
  gates: {
    secrets: GateLevel;
    destructiveMigration: GateLevel;
    committedDependencies: GateLevel;
  };
  /** Paths that need a deliberate decision to change. */
  protectedPaths: string[];
  /** Shared mode: require an approving review (only takes effect if an approver exists). */
  requireApproval: boolean;
  /** Shared mode: review comments must be resolved before merging. */
  requireConversationResolution: boolean;
  /** Shared mode: CodeWorthy's review must pass before merging. */
  requireCodeworthyCheck: boolean;
}

export const DEFAULT_RULES: RepoRules = {
  gates: { secrets: "gate", destructiveMigration: "gate", committedDependencies: "gate" },
  protectedPaths: [],
  requireApproval: true,
  requireConversationResolution: true,
  requireCodeworthyCheck: true,
};

const isLevel = (v: unknown): v is GateLevel => v === "gate" || v === "advise" || v === "off";

/** Narrow whatever the dashboard sent into rules we're willing to store. */
export function parseRules(raw: unknown, base: RepoRules = DEFAULT_RULES): RepoRules {
  const o = (raw ?? {}) as Record<string, any>;
  const g = (o.gates ?? {}) as Record<string, unknown>;
  return {
    gates: {
      secrets: isLevel(g.secrets) ? g.secrets : base.gates.secrets,
      destructiveMigration: isLevel(g.destructiveMigration) ? g.destructiveMigration : base.gates.destructiveMigration,
      committedDependencies: isLevel(g.committedDependencies) ? g.committedDependencies : base.gates.committedDependencies,
    },
    protectedPaths: Array.isArray(o.protectedPaths)
      ? o.protectedPaths.map((p: unknown) => String(p).trim()).filter(Boolean).slice(0, 50)
      : base.protectedPaths,
    requireApproval: typeof o.requireApproval === "boolean" ? o.requireApproval : base.requireApproval,
    requireConversationResolution:
      typeof o.requireConversationResolution === "boolean" ? o.requireConversationResolution : base.requireConversationResolution,
    requireCodeworthyCheck:
      typeof o.requireCodeworthyCheck === "boolean" ? o.requireCodeworthyCheck : base.requireCodeworthyCheck,
  };
}

export async function getRepoRules(pool: Pool, repo: string): Promise<RepoRules> {
  const { rows } = await pool.query(
    `SELECT payload->'rules' AS rules FROM audit_events
      WHERE repo = $1 AND event_type = 'repo.rules_set'
      ORDER BY ts DESC, id DESC LIMIT 1`,
    [repo]
  );
  return rows[0]?.rules ? parseRules(rows[0].rules) : DEFAULT_RULES;
}

/** Record a rules change, with what actually changed, in plain language. */
export async function setRepoRules(
  pool: Pool,
  o: { repo: string; rules: RepoRules; previous: RepoRules; actor: string; installationId: number | null }
): Promise<string[]> {
  const changes = describeChanges(o.previous, o.rules);
  await appendAuditEvent(pool, {
    installationId: o.installationId,
    repo: o.repo,
    eventType: "repo.rules_set",
    actor: o.actor,
    payload: { rules: o.rules, changes },
    plainEnglish: changes.length
      ? `${o.actor} changed what has to be true for a change to land in ${o.repo}: ${changes.join("; ")}.`
      : `${o.actor} saved the rules for ${o.repo} without changing anything.`,
  });
  return changes;
}

/**
 * What changed, said the way a person would say it.
 *
 * LOOSENING is named as loosening. A rules page that reports "secrets: advise"
 * lets someone turn off the control that stops a leaked key reaching main and
 * leaves no trace a reader would notice; "secrets no longer block a merge —
 * they are now only a comment" is the same fact stated so it cannot be skimmed
 * past. The record is read by people, so it has to read like one.
 */
export function describeChanges(before: RepoRules, after: RepoRules): string[] {
  const out: string[] = [];
  const gateNames: Record<keyof RepoRules["gates"], string> = {
    secrets: "committed secrets",
    destructiveMigration: "migrations that drop data",
    committedDependencies: "committed dependencies",
  };
  for (const key of Object.keys(gateNames) as Array<keyof RepoRules["gates"]>) {
    const b = before.gates[key];
    const a = after.gates[key];
    if (b === a) continue;
    const name = gateNames[key];
    if (a === "gate") out.push(`${name} now block a merge`);
    else if (a === "advise") out.push(`${name} no longer block a merge — they are now only a comment`);
    else out.push(`${name} are no longer checked at all`);
  }
  const flag = (b: boolean, a: boolean, on: string, off: string) => (b === a ? null : a ? on : off);
  const flags = [
    flag(before.requireApproval, after.requireApproval, "an approving review is now required", "an approving review is no longer required"),
    flag(before.requireCodeworthyCheck, after.requireCodeworthyCheck, "CodeWorthy's review must now pass before merging", "CodeWorthy's review no longer has to pass before merging"),
    flag(before.requireConversationResolution, after.requireConversationResolution, "review comments must now be resolved before merging", "review comments no longer have to be resolved before merging"),
  ].filter(Boolean) as string[];
  out.push(...flags);

  const added = after.protectedPaths.filter((p) => !before.protectedPaths.includes(p));
  const removed = before.protectedPaths.filter((p) => !after.protectedPaths.includes(p));
  if (added.length) out.push(`${added.join(", ")} now need a deliberate decision to change`);
  if (removed.length) out.push(`${removed.join(", ")} are no longer protected paths`);
  return out;
}

/** The gate's view of these rules. */
export function toStewardConfig(rules: RepoRules): StewardConfig {
  return {
    ...DEFAULT_CONFIG,
    gates: { ...rules.gates },
    protectedPaths: rules.protectedPaths,
  };
}

/** GitHub's view of these rules. */
export function toRulesetShape(
  rules: RepoRules,
  o: { checkName: string; mode: RepoMode; approverAvailable: boolean }
): RulesetShape {
  return {
    checkName: o.checkName,
    mode: o.mode,
    // An approval is required only if the repo asks for one AND an approver
    // exists to give it. Either alone is not enough: wanting one we cannot
    // satisfy is an unmergeable repository.
    requireApproval: rules.requireApproval && o.approverAvailable,
    requireConversationResolution: rules.requireConversationResolution,
    requireCheck: rules.requireCodeworthyCheck,
  };
}
