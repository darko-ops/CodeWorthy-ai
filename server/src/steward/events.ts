// Maps GitHub webhook events to audit-spine entries. In M1 the handlers only
// observe-and-log — the spine everything flows through. M2 adds the actions
// (safe-mechanics, protection config); those will append here too.
import type { Pool } from "pg";
import { appendAuditEvent, type StewardEvent } from "../audit/audit.js";

type Json = Record<string, any>;

/** Build the StewardEvent for a webhook, or null if we don't log this one in M1. */
export function toStewardEvent(eventName: string, payload: Json): StewardEvent | null {
  const repo: string = payload.repository?.full_name ?? payload.installation?.account?.login ?? "unknown";
  const installationId: number | null = payload.installation?.id ?? null;

  switch (eventName) {
    case "installation": {
      const account = payload.installation?.account?.login ?? "an account";
      const n = payload.repositories?.length ?? payload.installation?.repository_selection ?? "selected";
      if (payload.action === "created")
        return event(installationId, repo, "installation.created", payload.sender?.login,
          { account, repositories: n }, `CodeWorthy Steward was installed on ${account}.`);
      if (payload.action === "deleted")
        return event(installationId, repo, "installation.deleted", payload.sender?.login,
          { account }, `CodeWorthy Steward was uninstalled from ${account}.`);
      return null;
    }
    case "installation_repositories": {
      // Repos entering/leaving stewardship — the corroborating spine record for
      // the coverage-window transitions (V0.4, audit/coverage.ts).
      const added = ((payload.repositories_added ?? []) as Array<{ full_name?: string }>).map((r) => r.full_name).filter(Boolean);
      const removed = ((payload.repositories_removed ?? []) as Array<{ full_name?: string }>).map((r) => r.full_name).filter(Boolean);
      if (added.length === 0 && removed.length === 0) return null;
      const bits: string[] = [];
      if (added.length) bits.push(`now watching ${added.join(", ")}`);
      if (removed.length) bits.push(`no longer watching ${removed.join(", ")}`);
      return event(installationId, repo, "installation.repos_changed", payload.sender?.login,
        { added, removed }, `CodeWorthy Steward coverage changed: ${bits.join("; ")}.`);
    }
    case "push": {
      const branch = (payload.ref ?? "").replace("refs/heads/", "");
      const isDefault = branch && branch === payload.repository?.default_branch;
      const commits = payload.commits?.length ?? 0;
      const created = payload.created === true;
      if (isDefault && payload.forced === true) {
        // V0.3: a force-push to the default branch rewrites shared history —
        // a first-class exception, logged even when the push carries commits
        // (it supersedes the ordinary direct-push entry for this delivery).
        return event(installationId, repo, "exception.force_push", payload.pusher?.name,
          { branch, head: payload.after, before: payload.before },
          `Exception: ${payload.pusher?.name ?? "someone"} force-pushed ${branch} in ${repo}, rewriting its history — commits that were there before may be gone.`);
      }
      if (isDefault && !created && commits > 0) {
        // Direct push to the default branch — M2 opens a retroactive draft PR;
        // M1 records it so the change log shows it from day one.
        return event(installationId, repo, "push.direct_to_default", payload.pusher?.name,
          { branch, commits, head: payload.after },
          `${payload.pusher?.name ?? "someone"} pushed ${commits} commit(s) straight to ${branch} in ${repo} — no pull request reviewed them.`);
      }
      return null;
    }
    case "pull_request": {
      const num = payload.pull_request?.number;
      if (payload.action === "opened")
        return event(installationId, repo, "pull_request.opened", payload.sender?.login,
          { number: num, title: payload.pull_request?.title },
          `${payload.sender?.login ?? "someone"} opened PR #${num} in ${repo}.`);
      if (payload.action === "closed" && payload.pull_request?.merged) {
        const pr = payload.pull_request;
        // Everything the webhook itself carries (no API calls here — this
        // handler stays pure). The merge SHA is the JOIN KEY of the evidence
        // graph (docs/validator-build-plan.md V0.2): approvals, checks, and any
        // downstream deploy evidence all attach to it. The API-gathered half
        // (approvers, checks-at-merge) lands separately as `change.merged`.
        return event(installationId, repo, "pull_request.merged", payload.sender?.login,
          {
            number: num,
            mergeSha: pr.merge_commit_sha ?? null,
            headSha: pr.head?.sha ?? null,
            base: pr.base?.ref ?? null,
            author: pr.user?.login ?? null,
            mergedBy: pr.merged_by?.login ?? payload.sender?.login ?? null,
            mergedAt: pr.merged_at ?? null,
          },
          `PR #${num} in ${repo} was merged by ${pr.merged_by?.login ?? payload.sender?.login ?? "someone"}.`);
      }
      return null;
    }
    default:
      return null;
  }
}

/** Verify-then-dispatch entry: caller passes the parsed payload; we log it. */
export async function handleEvent(pool: Pool, eventName: string, payload: Json): Promise<string | null> {
  const ev = toStewardEvent(eventName, payload);
  if (!ev) return null;
  return appendAuditEvent(pool, ev);
}

function event(installationId: number | null, repo: string, eventType: string, actor: string | undefined | null, payload: unknown, plainEnglish: string): StewardEvent {
  return { installationId, repo, eventType, actor: actor ?? null, payload, plainEnglish };
}
