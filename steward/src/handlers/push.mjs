// Push handler — the safe-mechanics tier.
//
// An honest note on semantics (this diverges deliberately from the one-line
// brief "auto-create a branch when someone edits main"): once a push has
// landed on the default branch, moving it to a branch would require rewriting
// main — a force-push — which Steward is forbidden to do by its own doctrine.
// So the mechanics are:
//   • push lands on the default branch → save a RESTORE POINT branch at the
//     previous head (purely additive), coach in plain language on the commit,
//     and point at `.steward.yml` `protect: true` (the actual cure — after
//     protection, GitHub itself blocks the direct push before it lands).
//   • push lands on any other branch with no open PR → draft the PR for them
//     (the real "does the mechanics for you" move).
// Every action is logged to the audit chain.
import { draftPrBody, describeDiffStats, mainPushCoaching } from "../plain.mjs";
import { loadConfig } from "../policy.mjs";
import { applyProtectionIfConsented } from "../protection.mjs";

const ZERO_SHA = "0000000000000000000000000000000000000000";

export async function handlePush({ payload, broker, audit }) {
  const repoFull = payload.repository.full_name;
  const [owner, repo] = repoFull.split("/");
  const installationId = payload.installation.id;
  const branch = payload.ref.replace("refs/heads/", "");
  const defaultBranch = payload.repository.default_branch;
  const pusher = payload.pusher?.name ?? payload.sender?.login ?? "unknown";

  // Never react to our own writes, branch deletions, or tag pushes.
  if (payload.sender?.type === "Bot") return { skipped: "bot push" };
  if (!payload.ref.startsWith("refs/heads/")) return { skipped: "not a branch" };
  if (payload.deleted) return { skipped: "branch deletion" };

  const client = await broker.clientFor(installationId);
  const config = await loadConfig(client, owner, repo, defaultBranch);

  if (branch === defaultBranch) {
    return handleDefaultBranchPush({
      client,
      audit,
      config,
      payload,
      owner,
      repo,
      repoFull,
      installationId,
      branch,
      pusher,
    });
  }
  return handleFeatureBranchPush({
    client,
    audit,
    config,
    payload,
    owner,
    repo,
    repoFull,
    installationId,
    branch,
    pusher,
  });
}

async function handleDefaultBranchPush(ctx) {
  const { client, audit, config, payload, owner, repo, repoFull, installationId, branch, pusher } = ctx;
  const commitCount = payload.commits?.length ?? 0;
  const headSha = payload.after;
  const beforeSha = payload.before;

  // Restore point: a branch at the pre-push head. Additive and reversible —
  // it destroys nothing and rewrites nothing.
  let backupBranch = null;
  if (beforeSha && beforeSha !== ZERO_SHA) {
    backupBranch = `steward/restore-${beforeSha.slice(0, 7)}`;
    try {
      await client.createRef(owner, repo, backupBranch, beforeSha);
    } catch (err) {
      if (err.status !== 422) throw err; // 422 = already exists; fine
    }
  }

  await client.createCommitComment(
    owner,
    repo,
    headSha,
    mainPushCoaching({ branch, backupBranch, pusher, commitCount })
  );

  await audit({
    installationId,
    repo: repoFull,
    actor: pusher,
    eventType: "direct_push_to_default",
    payload: { branch, before: beforeSha, after: headSha, commits: commitCount, backupBranch },
    plainEnglish: `${pusher} pushed ${commitCount === 1 ? "a change" : `${commitCount} changes`} directly to ${branch} without a pull request${backupBranch ? `; Steward saved a restore point (${backupBranch})` : ""}.`,
  });

  // If the repo has consented via .steward.yml, (re)apply protection now —
  // the cure for the next direct push.
  const protection = await applyProtectionIfConsented({
    client,
    audit,
    config,
    owner,
    repo,
    repoFull,
    installationId,
    branch,
  });

  return { action: "default_branch_coaching", backupBranch, protection };
}

async function handleFeatureBranchPush(ctx) {
  const { client, audit, config, payload, owner, repo, repoFull, installationId, branch, pusher } = ctx;
  if (!config.draft_pr_on_branch_push) return { skipped: "draft_pr disabled" };
  if (branch.startsWith("steward/")) return { skipped: "steward housekeeping branch" };

  const open = await client.listPullsForBranch(owner, repo, branch);
  if (open.length > 0) return { skipped: "PR already open" };

  const commits = (payload.commits ?? []).map((c) => ({ message: c.message }));
  const title =
    commits[0]?.message.split("\n")[0]?.slice(0, 72) || `Changes on ${branch}`;
  const filesTouched = new Set(
    (payload.commits ?? []).flatMap((c) => [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])])
  );
  const filesSummary = describeDiffStats(
    [...filesTouched].map((f) => ({ filename: f, status: "modified", additions: 0, deletions: 0 }))
  );

  const pr = await client.createDraftPull(owner, repo, {
    title,
    head: branch,
    base: payload.repository.default_branch,
    body: draftPrBody({ branch, commits, filesSummary }),
  });

  await audit({
    installationId,
    repo: repoFull,
    actor: "steward",
    eventType: "draft_pr_created",
    payload: { branch, pr: pr.number, for: pusher },
    plainEnglish: `Steward opened draft pull request #${pr.number} for ${pusher}'s work on ${branch}, so the change gets a review step before it goes live.`,
  });

  return { action: "draft_pr_created", number: pr.number };
}
