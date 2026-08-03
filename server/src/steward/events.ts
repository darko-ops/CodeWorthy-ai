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
    case "push": {
      const branch = (payload.ref ?? "").replace("refs/heads/", "");
      const isDefault = branch && branch === payload.repository?.default_branch;
      const commits = payload.commits?.length ?? 0;
      const created = payload.created === true;
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
      if (payload.action === "closed" && payload.pull_request?.merged)
        return event(installationId, repo, "pull_request.merged", payload.sender?.login,
          { number: num }, `PR #${num} in ${repo} was merged by ${payload.sender?.login ?? "someone"}.`);
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
