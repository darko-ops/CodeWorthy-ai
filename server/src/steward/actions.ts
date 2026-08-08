// Turns logged events into Steward ACTIONS (M2). Everything here is guarded:
//   - No App credentials configured  -> no-op (local/dev stays log-only, M1).
//   - No installation id on the event -> no-op.
//   - Branch-protection auto-config   -> only with explicit consent
//     (STEWARD_AUTO_PROTECT=1), never silently changing someone's repo settings.
// The GitHub client is injectable so this is testable without live GitHub.
import type { Pool } from "pg";
import { config } from "../config.js";
import { getInstallationClient } from "../github/auth.js";
import type { GitHubClient } from "../github/client.js";
import { recordMergeEvidence } from "./mergeEvidence.js";
import { retroactiveReview } from "./mechanics.js";
import { configureProtection } from "./protection.js";
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

export async function runActions(pool: Pool, eventName: string, payload: any, deps: ActionDeps = {}): Promise<void> {
  const installationId: number | null = payload.installation?.id ?? null;
  // Without App creds (or an installation) we can't act — M1 already logged it.
  if (!deps.client && (!config.github.appId || installationId == null)) return;

  const client = deps.client ?? (await getInstallationClient(installationId!));
  const repo: string = payload.repository?.full_name ?? "";

  if (eventName === "push" && isDirectToDefault(payload)) {
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
      await configureProtection(client, pool, r.full_name, r.default_branch ?? "main", installationId);
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

  if (eventName === "pull_request" && (payload.action === "opened" || payload.action === "synchronize")) {
    // The LLM advise tier. Doubly guarded: the repo config must opt in, AND
    // either the operator opted in globally OR a client was injected (tests).
    // The tier only ADVISES — reviewPullRequest cannot gate, merge, or change
    // settings; it posts one comment and logs it. No creds/key => stays silent.
    const repoConfig = deps.config ?? DEFAULT_CONFIG;
    if (!llmReviewEnabled(repoConfig, deps.llm ? true : config.llmEnabled)) return;
    const llm = deps.llm ?? getAnthropicClient();
    if (!llm) return; // no ANTHROPIC_API_KEY -> tier unavailable, deterministic-only

    const pr = payload.pull_request ?? {};
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
}

export function isDirectToDefault(payload: any): boolean {
  const branch = (payload.ref ?? "").replace("refs/heads/", "");
  return Boolean(branch && branch === payload.repository?.default_branch && payload.created !== true && (payload.commits?.length ?? 0) > 0);
}
