// The protection spine: ensure, verify, restore.
//
// `protection.ts` knows the legacy branch-protection mechanism and `rulesets.ts`
// knows the modern one. This module is the policy on top of both, and it is
// where "CodeWorthy IS your branch protection" actually lives:
//
//   ensureProtection   — put the rule in place (ruleset, legacy as fallback)
//   enforceProtection  — compare live state to desired; RESTORE it if weakened
//   recordBypass       — notice when something got past the rule anyway
//
// Detecting drift and merely reporting it is what a monitoring tool does. The
// difference here is the restore: a weakened rule is put back by default, and
// both the weakening and the restoration are exceptions in the audit spine, so
// an auditor sees the deviation AND the correction with timestamps.
//
// Restoring is still a bounded act. It only ever re-asserts the rule we
// originally applied with consent; it never escalates scope, never touches
// another ruleset, and never removes anyone's access. If the human wants
// protection off, they turn it off in GitHub — and CodeWorthy records that
// choice rather than fighting them over it.
import type { Pool } from "pg";
import { appendAuditEvent } from "../audit/audit.js";
import { isNotFound, type GitHubClient } from "../github/client.js";
import { STEWARD_CHECK, configureProtection, detectProtectionDrift } from "./protection.js";
import { applyRuleset, detectRulesetDrift, inspectProtection, RULESET_NAME, type RulesetShape } from "./rulesets.js";
import { getRepoMode, type RepoMode } from "./repoMode.js";
import { config } from "../config.js";
import { approverClientFor } from "../approver/client.js";

export interface EnsureOptions {
  defaultBranch?: string;
  checkName?: string;
  /** Omit to read the repo's recorded mode from the spine. */
  mode?: RepoMode;
}

/**
 * An approval can only be required when an independent approver exists to give
 * it — ON THIS REPOSITORY.
 *
 * This was global: "is an approver configured anywhere?" The moment the
 * operator set APPROVER_APP_ID, every shared repo would get
 * required_approving_review_count: 1 on its next protection apply — including
 * repos the approver App was never installed on, which have nobody able to
 * approve and therefore nothing that can ever merge. That is the same failure
 * as requiring a check nobody posts, which is the bug this entire tier exists
 * to fix, reintroduced one layer up.
 *
 * So the question is asked per repository, by actually resolving the approver's
 * own installation there. If that lookup fails for any reason, the answer is
 * NO: the cost of wrongly not requiring an approval is one unapproved merge,
 * and the cost of wrongly requiring one is a repository nobody can merge to.
 * Those are not symmetric.
 */
export async function approvalRequired(repo: string): Promise<boolean> {
  if (!config.approver.appId) return false;
  try {
    return (await approverClientFor(repo)) != null;
  } catch {
    return false;
  }
}

export interface EnsureResult {
  mechanism: "ruleset" | "branch-protection" | "none";
  action: "created" | "updated" | "applied" | "failed";
  detail?: string;
}

/**
 * Put protection in place. Rulesets first; legacy branch protection only if the
 * rulesets API is unavailable (older GHES, a plan without it, a permissions
 * gap). Both paths append their own `protection.configured` event.
 */
export async function ensureProtection(
  client: GitHubClient,
  pool: Pool,
  repo: string,
  installationId: number | null,
  opts: EnsureOptions = {}
): Promise<EnsureResult> {
  const checkName = opts.checkName ?? STEWARD_CHECK;
  const mode = opts.mode ?? (await getRepoMode(pool, repo));
  const shape: RulesetShape = { checkName, mode, requireApproval: await approvalRequired(repo) };
  try {
    const applied = await applyRuleset(client, pool, repo, installationId, shape);
    return { mechanism: "ruleset", action: applied.action };
  } catch (rulesetErr) {
    const reason = rulesetErr instanceof Error ? rulesetErr.message : String(rulesetErr);
    try {
      // The legacy mechanism has no solo shape — it can only require a PR or
      // not protect at all. For a solo repo, requiring a PR is exactly what the
      // user asked us not to do, so we decline rather than silently re-block
      // them and call it a fallback.
      if (mode === "solo") {
        await appendAuditEvent(pool, {
          installationId,
          repo,
          eventType: "exception.protection_unavailable",
          actor: "codeworthy-steward",
          payload: { repo, mode, detail: reason, note: "solo mode needs rulesets; the legacy mechanism can't express it" },
          plainEnglish: `Exception: CodeWorthy couldn't apply solo-mode protection to ${repo} (${reason}). It did NOT fall back to the older mechanism, because that would have required a pull request for every change — the opposite of what solo mode is for. The branch is unprotected.`,
        });
        return { mechanism: "none", action: "failed", detail: reason };
      }
      await configureProtection(client, pool, repo, opts.defaultBranch ?? "main", installationId, checkName);
      await appendAuditEvent(pool, {
        installationId,
        repo,
        eventType: "protection.fallback",
        actor: "codeworthy-steward",
        payload: { reason, mechanism: "branch-protection", branch: opts.defaultBranch ?? "main" },
        plainEnglish: `CodeWorthy couldn't use a repository ruleset on ${repo} (${reason}), so it protected the branch the older way instead. The protection is in force; only the mechanism differs.`,
      });
      return { mechanism: "branch-protection", action: "applied", detail: reason };
    } catch (legacyErr) {
      const detail = `${reason}; fallback: ${legacyErr instanceof Error ? legacyErr.message : String(legacyErr)}`;
      await appendAuditEvent(pool, {
        installationId,
        repo,
        eventType: "exception.protection_unavailable",
        actor: "codeworthy-steward",
        payload: { repo, detail },
        plainEnglish: `Exception: CodeWorthy could not protect ${repo} — ${detail}. The branch is NOT protected; this needs a human.`,
      });
      return { mechanism: "none", action: "failed", detail };
    }
  }
}

export interface EnforceResult {
  status: "healthy" | "restored" | "weakened" | "unprotected" | "error";
  weakenings: string[];
  restored: boolean;
}

/**
 * Compare live protection to desired and put it back if it drifted.
 *
 * `restore: false` degrades this to detect-and-log — the old behavior — which
 * is what a repo that has explicitly opted out of self-healing gets.
 */
export async function enforceProtection(
  client: GitHubClient,
  pool: Pool,
  repo: string,
  installationId: number | null,
  opts: { restore?: boolean; defaultBranch?: string; checkName?: string; trigger?: string } = {}
): Promise<EnforceResult> {
  const checkName = opts.checkName ?? STEWARD_CHECK;
  const restoreAllowed = opts.restore !== false;
  const trigger = opts.trigger ?? "check";
  // The repo's own mode decides what "correct" means here. Without this the
  // sweep would read every solo repo as weakened and re-impose shared rules on
  // it every hour — overriding a deliberate choice, on a schedule.
  const mode = await getRepoMode(pool, repo);
  const shape: RulesetShape = { checkName, mode, requireApproval: await approvalRequired(repo) };

  // Reading the live state has three outcomes, and conflating any two of them is
  // how a guardrail does damage: (a) the rule is there — diff it; (b) the rule
  // is absent (404) — restore it; (c) we could not look (401/403/5xx) — say so
  // and touch nothing. Only a 404 counts as absence.
  let weakenings: string[] = [];
  let hadRuleset = false;
  let unreadable: string | null = null;

  try {
    const inspected = await inspectProtection(client, repo, shape);
    weakenings = inspected.weakenings;
    hadRuleset = inspected.rulesetId != null;
  } catch (err) {
    // A 404 here means this host/plan has no rulesets API, not that we're
    // locked out — fall through and check the legacy mechanism.
    if (!isNotFound(err)) unreadable = err instanceof Error ? err.message : String(err);
  }

  if (!hadRuleset && unreadable == null) {
    // No ruleset — but the repo may be on the legacy mechanism (the fallback
    // path, or protection applied before rulesets). Don't call it unprotected
    // until we've looked there too.
    try {
      const legacy = await client.getBranchProtection(repo, opts.defaultBranch ?? "main");
      if (legacy) weakenings = detectProtectionDrift(legacy, checkName);
    } catch (err) {
      if (isNotFound(err)) weakenings = detectRulesetDrift(null, shape); // genuinely unprotected
      else unreadable = err instanceof Error ? err.message : String(err);
    }
  }

  if (unreadable != null) {
    await appendAuditEvent(pool, {
      installationId,
      repo,
      eventType: "exception.protection_check_failed",
      actor: "codeworthy-steward",
      payload: { repo, detail: unreadable, trigger },
      plainEnglish: `Exception: CodeWorthy could not read the protection settings on ${repo} (${unreadable}), so it can't confirm the branch is still protected. It changed nothing — an unreadable repository is not the same as an unprotected one.`,
    });
    return { status: "error", weakenings: [], restored: false };
  }

  if (weakenings.length === 0) return { status: "healthy", weakenings: [], restored: false };

  const unprotected = weakenings.some((w) => w.includes("off entirely"));
  await appendAuditEvent(pool, {
    installationId,
    repo,
    eventType: "exception.protection_weakened",
    actor: "codeworthy-steward",
    payload: { weakenings, mode, mechanism: hadRuleset ? "ruleset" : "branch-protection", rulesetName: RULESET_NAME, trigger },
    plainEnglish: `Exception: branch protection on ${repo} was weakened — ${weakenings.join("; ")}.${restoreAllowed ? " CodeWorthy is restoring it." : " CodeWorthy is configured to report this rather than restore it."}`,
  });

  if (!restoreAllowed) {
    return { status: unprotected ? "unprotected" : "weakened", weakenings, restored: false };
  }

  const applied = await ensureProtection(client, pool, repo, installationId, {
    defaultBranch: opts.defaultBranch,
    checkName,
    mode,
  });
  if (applied.action === "failed") {
    return { status: unprotected ? "unprotected" : "weakened", weakenings, restored: false };
  }

  await appendAuditEvent(pool, {
    installationId,
    repo,
    eventType: "protection.restored",
    actor: "codeworthy-steward",
    payload: { weakenings, mechanism: applied.mechanism, trigger },
    plainEnglish: `CodeWorthy restored branch protection on ${repo} after it was weakened (${weakenings.join("; ")}). Both the change and the restoration are in this record, with times.`,
  });
  return { status: "restored", weakenings, restored: true };
}

/**
 * Something landed on the default branch without going through the rule.
 *
 * With protection on, a direct push to the default branch means someone with
 * bypass rights (a repo admin) went around it. That is allowed by design — and
 * it is exactly the event an auditor asks for, so it is recorded as a named
 * exception rather than an ordinary push.
 */
export async function recordBypass(
  pool: Pool,
  o: {
    repo: string;
    branch: string;
    actor: string | null;
    headSha: string | null;
    commitCount: number;
    installationId: number | null;
  }
): Promise<void> {
  await appendAuditEvent(pool, {
    installationId: o.installationId,
    repo: o.repo,
    eventType: "exception.protection_bypassed",
    actor: o.actor,
    payload: { branch: o.branch, headSha: o.headSha, commitCount: o.commitCount },
    plainEnglish: `Exception: ${o.actor ?? "someone"} pushed ${o.commitCount} commit(s) straight to ${o.branch} in ${o.repo} while branch protection was on — an admin override. The change is live and was never reviewed.`,
  });
}

/**
 * Did a human consent to protection anywhere in this installation?
 *
 * Consent is per-installation, not per-repo: someone who clicked "protect my
 * default branch" for their account meant it for the account, so a repo they
 * add later inherits it. What they did NOT consent to is a different account,
 * which is why this is scoped to the installation id rather than global.
 */
export async function installationEverConsented(pool: Pool, installationId: number | null): Promise<boolean> {
  if (installationId == null) return false;
  const res = await pool.query(
    `SELECT 1 FROM audit_events
      WHERE installation_id = $1 AND event_type IN ('protection.configured','protection.restored')
      LIMIT 1`,
    [installationId]
  );
  return (res.rowCount ?? 0) > 0;
}

/** Has CodeWorthy ever put protection on this repo? Drives bypass detection. */
export async function protectionEverConfigured(pool: Pool, repo: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM audit_events
      WHERE repo = $1 AND event_type IN ('protection.configured','protection.restored')
      LIMIT 1`,
    [repo]
  );
  return (res.rowCount ?? 0) > 0;
}
