// Branch-protection configurator — Steward's one privileged act, and it only
// ever happens with configuration-as-consent (`protect: true` in the repo's
// .steward.yml). Applying, re-applying, and detecting drift are all logged to
// the audit chain; "protection weakened" is itself an audit event an auditor
// cares about.
import { protectionPayload } from "./policy.mjs";

export async function applyProtectionIfConsented(ctx) {
  const { client, audit, config, owner, repo, repoFull, installationId, branch } = ctx;
  if (!config.protect) return { applied: false, reason: "no consent (.steward.yml protect is not true)" };

  const current = await client.getBranchProtection(owner, repo, branch);
  const desired = protectionPayload();

  const alreadySafe =
    current &&
    current.allow_force_pushes?.enabled === false &&
    current.allow_deletions?.enabled === false &&
    Boolean(current.required_pull_request_reviews);
  if (alreadySafe) return { applied: false, reason: "already protected" };

  await client.applyBranchProtection(owner, repo, branch, desired);
  await audit({
    installationId,
    repo: repoFull,
    actor: "steward",
    eventType: current ? "protection_reapplied" : "protection_applied",
    payload: { branch, desired },
    plainEnglish: current
      ? `Steward re-applied the safety rules on ${branch} — they had been weakened (pull requests were no longer required, or force-pushes had been allowed).`
      : `Steward turned on the safety rules for ${branch}: changes must go through a pull request, and force-pushes and branch deletion are blocked.`,
  });
  return { applied: true, was: current ? "weakened" : "unprotected" };
}

// Nightly drift check across installations: advise-and-log, never silently
// re-tighten beyond what consent covers (re-applying the consented baseline
// is allowed; anything else is a coaching comment).
export async function checkProtectionDrift(ctx) {
  const { client, audit, config, owner, repo, repoFull, installationId, branch } = ctx;
  if (!config.protect) return { checked: false };
  const current = await client.getBranchProtection(owner, repo, branch);
  const weakened =
    !current ||
    current.allow_force_pushes?.enabled === true ||
    current.allow_deletions?.enabled === true ||
    !current.required_pull_request_reviews;
  if (!weakened) return { checked: true, ok: true };

  await audit({
    installationId,
    repo: repoFull,
    actor: "steward",
    eventType: "protection_drift_detected",
    payload: { branch, current: current ?? null },
    plainEnglish: `The safety rules on ${branch} are weaker than the agreed setup (protection was ${current ? "modified" : "removed"}). Steward is restoring the agreed baseline.`,
  });
  return applyProtectionIfConsented(ctx).then((r) => ({ checked: true, ok: false, restored: r.applied }));
}
