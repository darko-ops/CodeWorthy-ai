// Branch-protection configurator (tier 3.2) + drift detection.
//
// The cure for direct-to-main: turn on protection so GitHub itself requires a
// PR and blocks force-pushes/deletions. Applied only with explicit consent
// (never silently — see actions.ts), and every change is an audit event.
// Drift detection makes "someone weakened protection" itself an audit event,
// which SOC 2 auditors specifically care about.
import type { Pool } from "pg";
import { appendAuditEvent } from "../audit/audit.js";
import type { GitHubClient } from "../github/client.js";

export const STEWARD_CHECK = "CodeWorthy PR review";

/** The protection we want on a default branch. Requires a PR, our check, and
 *  blocks force-pushes + deletions. enforce_admins:false so an admin CAN bypass
 *  — but that bypass surfaces as a logged event, rather than being impossible. */
export function desiredProtection(checkName: string = STEWARD_CHECK) {
  return {
    required_status_checks: { strict: true, contexts: [checkName] },
    enforce_admins: false,
    required_pull_request_reviews: { required_approving_review_count: 0 },
    restrictions: null,
    allow_force_pushes: false,
    allow_deletions: false,
  };
}

export async function configureProtection(
  client: GitHubClient,
  pool: Pool,
  repo: string,
  branch: string,
  installationId: number | null,
  checkName: string = STEWARD_CHECK
): Promise<void> {
  await client.setBranchProtection(repo, branch, desiredProtection(checkName));
  await appendAuditEvent(pool, {
    installationId,
    repo,
    eventType: "protection.configured",
    actor: "codeworthy-steward",
    payload: { branch, requires: ["pull_request", checkName], blocks: ["force_push", "deletion"] },
    plainEnglish: `CodeWorthy turned on branch protection for ${branch} in ${repo}: changes now need a pull request and the "${checkName}" check, and force-pushes and branch deletion are blocked.`,
  });
}

/** Compare GitHub's current protection to what we want; return plain-language
 *  weakenings (empty = healthy). GitHub's GET shape nests differently than PUT. */
export function detectProtectionDrift(current: any, checkName: string = STEWARD_CHECK): string[] {
  const weak: string[] = [];
  if (!current || typeof current !== "object") return [`branch protection is off entirely`];
  if (current.allow_force_pushes?.enabled === true) weak.push("force-pushes are now allowed");
  if (current.allow_deletions?.enabled === true) weak.push("branch deletion is now allowed");
  if (!current.required_pull_request_reviews) weak.push("a pull request is no longer required");
  const contexts: string[] = current.required_status_checks?.contexts ?? [];
  if (!contexts.includes(checkName)) weak.push(`the "${checkName}" check is no longer required`);
  return weak;
}

/** Fetch current protection, detect drift, and log it if weakened (advise). */
export async function runDriftCheck(
  client: GitHubClient,
  pool: Pool,
  repo: string,
  branch: string,
  installationId: number | null,
  checkName: string = STEWARD_CHECK
): Promise<string[]> {
  let current: any = null;
  try {
    current = await client.getBranchProtection(repo, branch);
  } catch {
    current = null; // 404 = protection off
  }
  const weak = detectProtectionDrift(current, checkName);
  if (weak.length) {
    await appendAuditEvent(pool, {
      installationId,
      repo,
      // V0.3: part of the exception.* family — the first-class register of
      // control deviations an auditor tests. (Pre-V0.3 rows carry the old name
      // `protection.weakened`; consumers handle both, history is never renamed.)
      eventType: "exception.protection_weakened",
      actor: "codeworthy-steward",
      payload: { branch, weakenings: weak },
      plainEnglish: `Exception: branch protection on ${branch} in ${repo} was weakened — ${weak.join("; ")}. CodeWorthy can restore it.`,
    });
  }
  return weak;
}
