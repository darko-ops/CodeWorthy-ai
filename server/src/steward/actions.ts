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
import { retroactiveReview } from "./mechanics.js";
import { configureProtection } from "./protection.js";

export interface ActionDeps {
  client?: GitHubClient; // injected in tests
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
  }
}

export function isDirectToDefault(payload: any): boolean {
  const branch = (payload.ref ?? "").replace("refs/heads/", "");
  return Boolean(branch && branch === payload.repository?.default_branch && payload.created !== true && (payload.commits?.length ?? 0) > 0);
}
