// Safe-mechanics (tier 3.1). Honest semantics: when a commit lands directly on
// the default branch, it is ALREADY there. Making it "go through a PR" after the
// fact would require moving the branch back — a force-push we forbid ourselves.
// So the mechanic is retroactive and ADDITIVE:
//   1. preserve a branch (steward/edit-<sha>) pointing at the commit, and
//   2. leave a plain-language comment on that exact commit — the review surface
//      attaches to the change that skipped review,
//   3. log it.
// The real cure is protection.ts (3.2): once branch protection is on, GitHub
// blocks the direct push and the *next* change goes through a real PR. This
// mechanic is the bridge, not the fix — which is why it doesn't pretend to be a
// PR it structurally cannot open.
import type { Pool } from "pg";
import { appendAuditEvent } from "../audit/audit.js";
import type { GitHubClient } from "../github/client.js";

export interface DirectPushContext {
  repo: string;
  defaultBranch: string;
  headSha: string;
  pusher: string | null;
  commitCount: number;
  installationId: number | null;
}

export async function retroactiveReview(client: GitHubClient, pool: Pool, ctx: DirectPushContext): Promise<void> {
  const short = ctx.headSha.slice(0, 12);
  const branch = `steward/edit-${short}`;

  // Preserve a named branch at the commit (idempotent — ignore "already exists").
  try {
    await client.createBranch(ctx.repo, branch, ctx.headSha);
  } catch {
    /* ref may already exist from a redelivered webhook; that's fine */
  }

  const note = [
    `⚠️ **This went straight to \`${ctx.defaultBranch}\` — no pull request reviewed it.**`,
    ``,
    `${ctx.commitCount} commit(s) landed directly on the default branch. Nothing looked at them before they became the live version.`,
    ``,
    `I've kept a branch \`${branch}\` pointing at this commit so the work is easy to find. I can't turn this into a pull request after the fact without rewriting history (which I never do) — but I *can* stop it happening again:`,
    ``,
    `**Turn on branch protection** and future changes to \`${ctx.defaultBranch}\` will go through a reviewable pull request first, with force-pushes and deletions blocked. Reply or check your CodeWorthy settings to enable it.`,
  ].join("\n");

  await client.createCommitComment(ctx.repo, ctx.headSha, note);

  await appendAuditEvent(pool, {
    installationId: ctx.installationId,
    repo: ctx.repo,
    eventType: "mechanic.retroactive_review",
    actor: "codeworthy-steward",
    payload: { branch, headSha: ctx.headSha, commitCount: ctx.commitCount, pusher: ctx.pusher },
    plainEnglish: `CodeWorthy preserved a branch (${branch}) and left a review note on the commit ${ctx.pusher ?? "someone"} pushed straight to ${ctx.defaultBranch} in ${ctx.repo}.`,
  });
}
