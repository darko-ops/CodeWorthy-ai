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

/** The plain-language change log — founder digest and auditor evidence, one query. */
export async function recentChangelog(
  pool: Pool,
  opts: { repo?: string; limit?: number } = {}
): Promise<ChangelogRow[]> {
  const limit = Math.min(opts.limit ?? 50, 500);
  const res = opts.repo
    ? await pool.query(
        `SELECT ts, repo, actor, event_type, plain_english FROM audit_changelog WHERE repo = $1 LIMIT $2`,
        [opts.repo, limit]
      )
    : await pool.query(`SELECT ts, repo, actor, event_type, plain_english FROM audit_changelog LIMIT $1`, [limit]);
  return res.rows;
}
