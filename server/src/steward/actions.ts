// Turns logged events into Steward ACTIONS (M2+), including the enforcement
// spine: the gate that posts the required check, and the protection that makes
// that check mean something.
//
// Guards that still hold:
//   - No App credentials configured  -> no-op (local/dev stays log-only, M1).
//   - No installation id on the event -> no-op.
//   - Turning protection ON needs consent: the operator's global opt-in
//     (STEWARD_AUTO_PROTECT=1) or a human clicking yes on /steward/setup.
//     KEEPING it on, once consented, is automatic — that's the product.
// The GitHub client is injectable so this is testable without live GitHub.
import type { Pool } from "pg";
import { config } from "../config.js";
import { getInstallationClient } from "../github/auth.js";
import type { GitHubClient } from "../github/client.js";
import { recordMergeEvidence } from "./mergeEvidence.js";
import { retroactiveReview } from "./mechanics.js";
import { runGate, runPostMergeGate } from "./gate/check.js";
import { getRepoMode } from "./repoMode.js";
import { runApprover } from "../approver/approve.js";
import { STEWARD_CHECK } from "./protection.js";
import {
  ensureProtection,
  enforceProtection,
  installationEverConsented,
  protectionEverConfigured,
  recordBypass,
} from "./enforce.js";
import { DEFAULT_CONFIG, type StewardConfig } from "./stewardConfig.js";
import { getAnthropicClient, type LlmClient } from "./llm/anthropic.js";
import { reviewPullRequest } from "./llm/reviewer.js";

export interface ActionDeps {
  client?: GitHubClient; // injected in tests
  llm?: LlmClient; // injected in tests; real one built from env when the tier is on
  config?: StewardConfig; // the repo's effective .steward.yml (defaults if absent)
}

// The LLM advise tier runs ONLY when both the operator (global) and the repo
// (.steward.yml) have turned it on. Off by default; opt-in on both sides.
// Injecting an llm client in tests stands in for the operator's global opt-in.
export function llmReviewEnabled(repoConfig: StewardConfig, operatorEnabled: boolean): boolean {
  return repoConfig.llm.enabled === true && operatorEnabled === true;
}

/** PR actions that change what the gate should say about the head commit. */
const GATED_PR_ACTIONS = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);

export async function runActions(pool: Pool, eventName: string, payload: any, deps: ActionDeps = {}): Promise<void> {
  const installationId: number | null = payload.installation?.id ?? null;
  // Without App creds (or an installation) we can't act — M1 already logged it.
  if (!deps.client && (!config.github.appId || installationId == null)) return;

  const client = deps.client ?? (await getInstallationClient(installationId!));
  const repo: string = payload.repository?.full_name ?? "";
  const repoConfig = deps.config ?? DEFAULT_CONFIG;

  // ── the gate: every head commit of every open PR gets a verdict ───────────
  if (eventName === "pull_request" && GATED_PR_ACTIONS.has(payload.action)) {
    const pr = payload.pull_request ?? {};
    if (pr.head?.sha) {
      await runGate(client, pool, {
        repo,
        number: pr.number,
        headSha: pr.head.sha,
        author: pr.user?.login ?? null,
        installationId,
        config: repoConfig,
        detailsUrl: `${config.baseUrl}/steward/health.html?repo=${encodeURIComponent(repo)}`,
      });
      // The approver runs AFTER the gate, because it decides on the gate's
      // verdict for this exact commit. It is a separate GitHub App with its own
      // credentials; if it isn't installed here it simply abstains.
      await runApprover(pool, {
        repo,
        number: pr.number,
        headSha: pr.head.sha,
        author: pr.user?.login ?? null,
        installationId,
      }).catch(() => {});
    }

    // The LLM advise tier, on top of (never instead of) the gate. Doubly
    // guarded: the repo config must opt in, AND either the operator opted in
    // globally OR a client was injected (tests). It only ADVISES.
    if (payload.action === "opened" || payload.action === "synchronize") {
      if (!llmReviewEnabled(repoConfig, deps.llm ? true : config.llmEnabled)) return;
      const llm = deps.llm ?? getAnthropicClient();
      if (!llm) return; // no ANTHROPIC_API_KEY -> tier unavailable, deterministic-only
      await reviewPullRequest(client, llm, pool, {
        repo,
        number: pr.number,
        title: pr.title ?? null,
        body: pr.body ?? null,
        headSha: pr.head?.sha ?? null,
        author: pr.user?.login ?? null,
        installationId,
        maxReviewsPerPr: repoConfig.llm.maxReviewsPerPr,
      });
    }
    return;
  }

  // The repo's OWN CI finishing changes the answer to "are its tests green?",
  // which the gate treats as blocking. Re-run it so a PR that went red after we
  // last looked stops being mergeable, and one that went green stops being
  // blocked. Without this, `merge_on_red` would only ever catch CI that
  // finished before the PR event — which is the uncommon case.
  if ((eventName === "check_suite" || eventName === "check_run") && payload.action === "completed") {
    // Ignore our OWN check completing. Re-gating on it would be a loop: post a
    // verdict -> the check completes -> re-gate -> post. The verdict fingerprint
    // stops it after one turn, but not reacting at all is cheaper and clearer.
    if (payload.check_run?.name === STEWARD_CHECK) return;
    if (isOurApp(payload.check_suite?.app?.id ?? payload.check_run?.app?.id)) return;

    const container = eventName === "check_suite" ? payload.check_suite : payload.check_run?.check_suite;
    const prs: Array<any> = container?.pull_requests ?? payload.check_run?.pull_requests ?? [];
    const headSha: string | null = container?.head_sha ?? payload.check_run?.head_sha ?? null;
    if (!headSha) return;
    for (const pr of prs) {
      if (typeof pr?.number !== "number") continue;
      await runGate(client, pool, {
        repo,
        number: pr.number,
        headSha,
        author: null,
        installationId,
        config: repoConfig,
        detailsUrl: `${config.baseUrl}/steward/health.html?repo=${encodeURIComponent(repo)}`,
      });
      await runApprover(pool, { repo, number: pr.number, headSha, author: null, installationId }).catch(() => {});
    }
    return;
  }

  // A waiver arrives as a comment ("@codeworthy waive <finding>: <reason>"), so
  // a comment has to make the approver look again — otherwise the user writes
  // the waiver and nothing happens until they push, which reads as broken.
  if (eventName === "issue_comment" && payload.action === "created" && payload.issue?.pull_request) {
    const number = payload.issue?.number;
    if (typeof number !== "number") return;
    if (!/@codeworthy\s+waive\s/i.test(payload.comment?.body ?? "")) return;
    const pr = (await client.getPullRequest(repo, number).catch(() => null)) as { head?: { sha?: string }; user?: { login?: string } } | null;
    if (!pr?.head?.sha) return;
    await runApprover(pool, {
      repo,
      number,
      headSha: pr.head.sha,
      author: pr.user?.login ?? null,
      installationId,
    }).catch(() => {});
    return;
  }

  // ── protection: drift reaches us as a webhook, in seconds ─────────────────
  // Someone editing or removing the rule is the moment enforcement matters
  // most. The scheduled sweep (protection-job.ts) is the backstop, not the
  // primary path.
  if (eventName === "repository_ruleset" || eventName === "branch_protection_rule") {
    if (payload.action === "created") return; // creating protection isn't drift
    if (!(await protectionEverConfigured(pool, repo))) return; // never ours to hold up
    await enforceProtection(client, pool, repo, installationId, {
      restore: config.protection.restoreDrift,
      defaultBranch: payload.repository?.default_branch ?? "main",
      trigger: `webhook:${eventName}.${payload.action}`,
    });
    return;
  }

  if (eventName === "push" && isDirectToDefault(payload)) {
    const branch = (payload.ref ?? "").replace("refs/heads/", "");
    const mode = await getRepoMode(pool, repo);

    // SOLO: pushing here is the agreed way of working, not a deviation. So it
    // is NOT an exception and NOT a bypass — recording it as one would fill the
    // exception register with the user's normal workflow and destroy the
    // meaning of the register itself. What happens instead is the review:
    // CodeWorthy reads the commit that landed and reports on it, marked
    // post-merge so nobody can later read it as a pre-merge gate.
    if (mode === "solo") {
      await runPostMergeGate(client, pool, {
        repo,
        sha: payload.after,
        branch,
        pusher: payload.pusher?.name ?? payload.sender?.login ?? null,
        installationId,
        config: repoConfig,
      });
      return;
    }

    // If protection is supposed to be on, a commit landing here means someone
    // with bypass rights went around it — a named exception, not a plain push.
    // It also means the rule itself may have been removed, so verify and
    // restore before doing anything else.
    if (await protectionEverConfigured(pool, repo)) {
      await recordBypass(pool, {
        repo,
        branch,
        actor: payload.pusher?.name ?? payload.sender?.login ?? null,
        headSha: payload.after ?? null,
        commitCount: payload.commits?.length ?? 0,
        installationId,
      });
      await enforceProtection(client, pool, repo, installationId, {
        restore: config.protection.restoreDrift,
        defaultBranch: payload.repository?.default_branch ?? "main",
        trigger: "push:direct_to_default",
      });
    }
    await retroactiveReview(client, pool, {
      repo,
      defaultBranch: payload.repository.default_branch,
      headSha: payload.after,
      pusher: payload.pusher?.name ?? null,
      commitCount: payload.commits?.length ?? 0,
      installationId,
    });
    return;
  }

  if (eventName === "installation" && payload.action === "created" && config.autoProtect) {
    // Consent-gated: only runs when the operator has opted in. The real product
    // gets consent on the install screen; the flag is the MVP stand-in.
    const repos: Array<{ full_name: string; default_branch?: string }> = payload.repositories ?? [];
    for (const r of repos) {
      await ensureProtection(client, pool, r.full_name, installationId, { defaultBranch: r.default_branch ?? "main" });
    }
    return;
  }

  // A repo ADDED to an installation that already consented inherits that
  // consent — otherwise every new repo silently starts out unprotected while
  // the dashboard says the account is covered.
  if (eventName === "installation_repositories" && payload.action === "added") {
    const added: Array<{ full_name: string; default_branch?: string }> = payload.repositories_added ?? [];
    if (!added.length) return;
    if (!config.autoProtect && !(await installationEverConsented(pool, installationId))) return;
    for (const r of added) {
      await ensureProtection(client, pool, r.full_name, installationId, { defaultBranch: r.default_branch ?? "main" });
    }
    return;
  }

  if (eventName === "pull_request" && payload.action === "closed" && payload.pull_request?.merged) {
    // V0.2: capture the control facts at merge time — approvers, self-approval,
    // checks on the head SHA — keyed on the merge commit SHA. Deterministic
    // reads + template text; failures are recorded as evidenceGaps, not hidden.
    const pr = payload.pull_request;
    await recordMergeEvidence(client, pool, {
      repo,
      number: pr.number,
      installationId,
      author: pr.user?.login ?? null,
      mergedBy: pr.merged_by?.login ?? payload.sender?.login ?? null,
      mergedAt: pr.merged_at ?? null,
      mergeSha: pr.merge_commit_sha ?? null,
      headSha: pr.head?.sha ?? null,
      base: pr.base?.ref ?? null,
    });
    return;
  }
}

/** Is this check suite ours? Compares against the App id we authenticate as. */
function isOurApp(appId: unknown): boolean {
  return appId != null && String(appId) === String(config.github.appId) && Boolean(config.github.appId);
}

export function isDirectToDefault(payload: any): boolean {
  const branch = (payload.ref ?? "").replace("refs/heads/", "");
  return Boolean(branch && branch === payload.repository?.default_branch && payload.created !== true && (payload.commits?.length ?? 0) > 0);
}
