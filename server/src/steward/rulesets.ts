// Branch protection via REPOSITORY RULESETS — the primitive CodeWorthy actually
// stands on.
//
// Why rulesets and not legacy branch protection:
//   - They are named objects. "CodeWorthy — protected default branch" is a thing
//     you can point an auditor at, diff against a desired state, and restore.
//     A legacy protection rule is an anonymous bag of settings on a branch.
//   - They target `~DEFAULT_BRANCH`, so renaming main doesn't silently unprotect
//     the repo — the single most common way a legacy rule quietly stops working.
//   - Bypass is a first-class, enumerable list (`bypass_actors`) instead of one
//     `enforce_admins` boolean, so "who can go around this, and did they" is an
//     answerable question rather than a guess.
//   - Weakening one emits a `repository_ruleset` webhook, so drift reaches us in
//     seconds rather than at the next scheduled sweep.
//
// The doctrine is unchanged: an admin CAN bypass. We do not make it impossible;
// we make it impossible to do QUIETLY. Every bypass and every weakening is an
// exception in the audit spine.
import type { Pool } from "pg";
import { appendAuditEvent } from "../audit/audit.js";
import type { GitHubClient } from "../github/client.js";
import { STEWARD_CHECK } from "./protection.js";

/** The name is the identity — we find, diff and restore our ruleset by it. */
export const RULESET_NAME = "CodeWorthy — protected default branch";

/** GitHub's repository-role actor id for "admin" (rulesets bypass_actors). */
const ROLE_ADMIN = 5;

export interface RulesetSummary {
  id: number;
  name: string;
  enforcement?: string;
}

/**
 * The ruleset we want on every stewarded repo.
 *
 * `strict_required_status_checks_policy` is deliberately FALSE: requiring every
 * branch to be rebased onto the latest main before merging is real engineering
 * hygiene, but for the person this product is for it turns into a merge button
 * that never works and a guardrail they turn off. We gate on correctness, not
 * on freshness.
 */
export function desiredRuleset(checkName: string = STEWARD_CHECK) {
  return {
    name: RULESET_NAME,
    target: "branch" as const,
    enforcement: "active" as const,
    // Repo admins can still get past it — visibly, and logged by us as an
    // exception. See the doctrine note at the top of this file.
    bypass_actors: [{ actor_id: ROLE_ADMIN, actor_type: "RepositoryRole" as const, bypass_mode: "always" as const }],
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" as const },
      { type: "non_fast_forward" as const }, // blocks force-pushes over shared history
      {
        type: "pull_request" as const,
        parameters: {
          // Zero required approvals on purpose: a solo builder has nobody to
          // approve their PR, and a rule that cannot be satisfied gets deleted.
          // The REVIEW that matters here is CodeWorthy's check below.
          required_approving_review_count: 0,
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks" as const,
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: checkName }],
        },
      },
    ],
  };
}

export type DesiredRuleset = ReturnType<typeof desiredRuleset>;

/** Find our ruleset on a repo by name, or null. */
export async function findOurRuleset(client: GitHubClient, repo: string): Promise<RulesetSummary | null> {
  const raw = (await client.listRepoRulesets(repo)) as unknown;
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    if (r?.name === RULESET_NAME && typeof r.id === "number") {
      return { id: r.id, name: RULESET_NAME, enforcement: typeof r.enforcement === "string" ? r.enforcement : undefined };
    }
  }
  return null;
}

export interface ApplyResult {
  mechanism: "ruleset";
  action: "created" | "updated";
  rulesetId: number | null;
}

/**
 * Create or update our ruleset so it matches the desired state exactly.
 * Idempotent: running it on an already-correct repo is a no-op update.
 */
export async function applyRuleset(
  client: GitHubClient,
  pool: Pool,
  repo: string,
  installationId: number | null,
  checkName: string = STEWARD_CHECK
): Promise<ApplyResult> {
  const desired = desiredRuleset(checkName);
  const existing = await findOurRuleset(client, repo);

  let action: ApplyResult["action"];
  let rulesetId: number | null;
  if (existing) {
    const updated = (await client.updateRepoRuleset(repo, existing.id, desired)) as { id?: number } | null;
    action = "updated";
    rulesetId = typeof updated?.id === "number" ? updated.id : existing.id;
  } else {
    const created = (await client.createRepoRuleset(repo, desired)) as { id?: number } | null;
    action = "created";
    rulesetId = typeof created?.id === "number" ? created.id : null;
  }

  await appendAuditEvent(pool, {
    installationId,
    repo,
    eventType: "protection.configured",
    actor: "codeworthy-steward",
    payload: {
      mechanism: "ruleset",
      rulesetName: RULESET_NAME,
      rulesetId,
      action,
      target: "~DEFAULT_BRANCH",
      requires: ["pull_request", checkName, "conversation_resolution"],
      blocks: ["force_push", "deletion"],
      bypass: ["repository admin (logged as an exception when used)"],
    },
    plainEnglish: `CodeWorthy ${action === "created" ? "turned on" : "reapplied"} branch protection for the default branch of ${repo}: changes now need a pull request and the "${checkName}" check, force-pushes and branch deletion are blocked, and comments must be resolved. A repository admin can still override it — and CodeWorthy records it as an exception when they do.`,
  });

  return { mechanism: "ruleset", action, rulesetId };
}

/**
 * Compare GitHub's current ruleset to what we want, in plain language.
 * Empty array = healthy. Order is worst-first so the first line is the headline.
 */
export function detectRulesetDrift(current: unknown, checkName: string = STEWARD_CHECK): string[] {
  if (!current || typeof current !== "object") return ["branch protection is off entirely — CodeWorthy's ruleset is gone"];
  const rs = current as Record<string, any>;
  const weak: string[] = [];

  if (rs.enforcement === "disabled") weak.push("protection was switched off (the ruleset still exists but enforces nothing)");
  else if (rs.enforcement === "evaluate") weak.push("protection was switched to report-only, so it no longer blocks anything");

  const include: string[] = rs.conditions?.ref_name?.include ?? [];
  if (!include.includes("~DEFAULT_BRANCH") && !include.includes("~ALL")) {
    weak.push("it no longer covers your default branch");
  }

  const rules: Array<Record<string, any>> = Array.isArray(rs.rules) ? rs.rules : [];
  const byType = new Map(rules.map((r) => [r?.type, r]));
  if (!byType.has("non_fast_forward")) weak.push("force-pushes are now allowed");
  if (!byType.has("deletion")) weak.push("branch deletion is now allowed");
  if (!byType.has("pull_request")) weak.push("a pull request is no longer required");

  const checks: Array<Record<string, any>> = byType.get("required_status_checks")?.parameters?.required_status_checks ?? [];
  if (!checks.some((c) => c?.context === checkName)) weak.push(`the "${checkName}" check is no longer required`);

  // Bypass beyond repo admin is a real widening: a Team or an Integration in
  // this list means something other than a human admin can route around it.
  const bypass: Array<Record<string, any>> = Array.isArray(rs.bypass_actors) ? rs.bypass_actors : [];
  const extra = bypass.filter((b) => !(b?.actor_type === "RepositoryRole" && Number(b?.actor_id) === ROLE_ADMIN));
  if (extra.length) {
    const who = extra.map((b) => `${b?.actor_type ?? "someone"}#${b?.actor_id ?? "?"}`).join(", ");
    weak.push(`more than repository admins can now bypass it (${who})`);
  }

  return weak;
}

export interface ProtectionCheck {
  /** null when we have no ruleset at all on the repo. */
  rulesetId: number | null;
  weakenings: string[];
  healthy: boolean;
}

/**
 * Fetch the live ruleset and diff it. Read-only — no writes, no logging.
 *
 * THROWS if GitHub won't answer, and that is deliberate: "we couldn't read the
 * settings" must never be silently reported as "there is no protection". The
 * caller turns the first into an exception a human looks at, and the second
 * into a restore — swapping them would have us writing repo settings on the
 * strength of a 401.
 */
export async function inspectProtection(
  client: GitHubClient,
  repo: string,
  checkName: string = STEWARD_CHECK
): Promise<ProtectionCheck> {
  const summary = await findOurRuleset(client, repo);
  if (!summary) return { rulesetId: null, weakenings: detectRulesetDrift(null, checkName), healthy: false };
  const full = await client.getRepoRuleset(repo, summary.id);
  const weakenings = detectRulesetDrift(full, checkName);
  return { rulesetId: summary.id, weakenings, healthy: weakenings.length === 0 };
}
