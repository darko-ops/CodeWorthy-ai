// The audit spine's write + read surface. Every Steward action appends here.
//
// There is intentionally NO update or delete function — the table is
// append-only (enforced in-schema and by grant). Adding one here would be the
// first step toward the thing the compliance guarantee forbids.
import type { Pool } from "pg";

export interface StewardEvent {
  installationId: number | null;
  repo: string; // "owner/name"
  eventType: string; // "installation.created", "push.direct_to_default", ...
  actor: string | null; // github login, when known
  payload: unknown; // structured detail
  plainEnglish: string; // the human sentence, composed at event time
}

export interface ChangelogRow {
  ts: string;
  repo: string;
  actor: string | null;
  event_type: string;
  plain_english: string;
}

/** Append one immutable audit event. Returns the new row id. */
export async function appendAuditEvent(pool: Pool, ev: StewardEvent): Promise<string> {
  const res = await pool.query(
    `INSERT INTO audit_events (installation_id, repo, event_type, actor, payload, plain_english)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [ev.installationId, ev.repo, ev.eventType, ev.actor, JSON.stringify(ev.payload ?? {}), ev.plainEnglish]
  );
  return String(res.rows[0].id);
}

/**
 * The plain-language change log — founder digest and auditor evidence, one query.
 *
 * `repos` is the scoped form: the repositories the caller may actually see.
 * It is NOT interchangeable with omitting the filter — an empty list means
 * "this caller can see nothing", and must return nothing. Reading an empty
 * scope as "no WHERE clause" is exactly how this endpoint came to serve every
 * tenant's record to anyone who asked, so the empty case is handled first and
 * explicitly rather than falling through to the unfiltered query below.
 */
export async function recentChangelog(
  pool: Pool,
  opts: { repo?: string; repos?: string[]; limit?: number; sinceDays?: number } = {}
): Promise<ChangelogRow[]> {
  if (opts.repos && opts.repos.length === 0) return [];
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (opts.repo) {
    params.push(opts.repo);
    conds.push(`repo = $${params.length}`);
  } else if (opts.repos) {
    params.push(opts.repos);
    conds.push(`repo = ANY($${params.length})`);
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    params.push(String(Math.min(opts.sinceDays, 365)));
    conds.push(`ts >= now() - ($${params.length} || ' days')::interval`);
  }
  params.push(limit);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const res = await pool.query(
    `SELECT ts, repo, actor, event_type, plain_english FROM audit_changelog ${where} LIMIT $${params.length}`,
    params
  );
  return res.rows;
}
