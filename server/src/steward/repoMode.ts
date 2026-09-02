// How a repository is worked on, and therefore what protection fits it.
//
//   shared — more than one person (or agent) lands changes. Every change goes
//            through a pull request that CodeWorthy reviews and an independent
//            approver approves. This is the default, because assuming a repo is
//            shared is the safe way to be wrong.
//
//   solo   — one maintainer, working in the repo directly. Pushing to the
//            default branch is allowed. CodeWorthy reviews what landed, after
//            it lands, and says so plainly in the record.
//
// Solo mode exists because the alternative is worse. A single maintainer forced
// to branch-and-PR against themselves either stops using the tool or turns the
// protection off entirely — and an unprotected repo with no record is a strictly
// worse outcome than a fast one with a complete record. What solo mode does NOT
// relax is the irreversible half: force-pushes and branch deletion stay blocked
// in both modes, because those destroy the history the record is made of.
//
// The mode lives in the audit spine rather than a settings table: who changed
// it, when, and to what is exactly the sort of thing an auditor asks about, and
// deriving it from the append-only log means it can't be changed without a
// trace. It reads the same way protection state does.
import type { Pool } from "pg";
import { appendAuditEvent } from "../audit/audit.js";

export type RepoMode = "solo" | "shared";

/** Absent any decision, a repo is treated as shared. Safe way to be wrong. */
export const DEFAULT_MODE: RepoMode = "shared";

export function isRepoMode(v: unknown): v is RepoMode {
  return v === "solo" || v === "shared";
}

/** The mode currently in force for one repo. */
export async function getRepoMode(pool: Pool, repo: string): Promise<RepoMode> {
  const { rows } = await pool.query(
    `SELECT payload->>'mode' AS mode FROM audit_events
      WHERE repo = $1 AND event_type = 'repo.mode_set'
      ORDER BY ts DESC, id DESC LIMIT 1`,
    [repo]
  );
  const mode = rows[0]?.mode;
  return isRepoMode(mode) ? mode : DEFAULT_MODE;
}

/** Modes for many repos at once — one query, for the portfolio view. */
export async function getRepoModes(pool: Pool, repos: string[]): Promise<Map<string, RepoMode>> {
  const out = new Map<string, RepoMode>();
  if (!repos.length) return out;
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (repo) repo, payload->>'mode' AS mode FROM audit_events
      WHERE repo = ANY($1) AND event_type = 'repo.mode_set'
      ORDER BY repo, ts DESC, id DESC`,
    [repos]
  );
  for (const r of rows) if (isRepoMode(r.mode)) out.set(r.repo, r.mode);
  return out;
}

/**
 * Record a mode change. The caller re-applies protection afterwards — this
 * function only states the decision, so the record shows the intent even if the
 * settings change that follows it fails.
 */
export async function setRepoMode(
  pool: Pool,
  o: { repo: string; mode: RepoMode; actor: string; installationId: number | null; reason?: string }
): Promise<void> {
  const english =
    o.mode === "solo"
      ? `${o.actor} set ${o.repo} to solo mode: one maintainer, working directly on the default branch. Pull requests are no longer required there. CodeWorthy reviews each change after it lands, and force-pushes and branch deletion stay blocked.`
      : `${o.actor} set ${o.repo} to shared mode: changes go through a pull request that CodeWorthy reviews before it can merge.`;
  await appendAuditEvent(pool, {
    installationId: o.installationId,
    repo: o.repo,
    eventType: "repo.mode_set",
    actor: o.actor,
    payload: { mode: o.mode, ...(o.reason ? { reason: o.reason } : {}) },
    plainEnglish: english,
  });
}
