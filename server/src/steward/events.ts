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
      // A squash-merge or merge-commit arrives here as a push to the default
      // branch, so this handler cannot tell "someone merged a reviewed pull
      // request" from "someone bypassed review" by shape alone. Recording the
      // first as the second put a flat contradiction in the record: the same
      // commit logged as `pull_request.merged` AND as "pushed straight to main
      // — no pull request reviewed them", seconds apart.
      //
      // This handler is deliberately pure (no API calls), so it uses the
      // message shape GitHub itself generates for merges. actions.ts does the
      // authoritative check before acting on it.
      if (isDefault && !created && commits > 0 && !looksLikeMerge(payload)) {
        return event(installationId, repo, "push.direct_to_default", payload.pusher?.name,
          { branch, commits, head: payload.after },
          `${payload.pusher?.name ?? "someone"} pushed ${commits} commit(s) straight to ${branch} in ${repo} — no pull request reviewed them.`);
      }
      return null;
    }
    case "repository_ruleset":
    case "branch_protection_rule": {
      // The raw fact that a protection rule changed, recorded independently of
      // whatever CodeWorthy does about it. The enforcement action (weakening
      // detected / protection restored) lands as its own event, so the spine
      // holds both "someone changed the rule" and "here is what we did", and an
      // auditor can line the two up by timestamp.
      const action = payload.action ?? "changed";
      const name = payload.repository_ruleset?.name ?? payload.rule?.name ?? "a protection rule";
      const who = payload.sender?.login ?? "someone";
      const isLoosening = action === "deleted" || action === "edited";
      return event(
        installationId,
        repo,
        isLoosening ? `exception.protection_rule_${action}` : `protection.rule_${action}`,
        payload.sender?.login,
        { rule: name, kind: eventName, action },
        `${who} ${action} the protection rule "${name}" on ${repo}.`
      );
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

/**
 * Does this push look like a pull request landing, rather than a bypass?
 *
 * GitHub writes both merge shapes itself: a squash lands as "<title> (#123)"
 * and a merge commit as "Merge pull request #123 from …". Matching on that is a
 * heuristic — a hand-written commit could imitate it — which is why it only
 * decides how the push is DESCRIBED here. Whether CodeWorthy acts on it is
 * settled against the API in actions.ts, where a wrong answer costs something.
 */
export function looksLikeMerge(payload: Json): boolean {
  const subject = String(payload.head_commit?.message ?? "").split("\n")[0] ?? "";
  return /\(#\d+\)\s*$/.test(subject) || /^Merge pull request #\d+\b/.test(subject);
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
