// Coverage windows (V0.4) — the explicit record of when each repo was under
// stewardship. The completeness statement (V1 reconciliation) is scoped to
// these intervals: "the log is complete for exactly these windows" is an
// auditable claim; an implied "since forever" is not.
//
// Windows open/close from installation-lifecycle webhooks. Close is an UPDATE
// of covered_to on the open window — the one deliberate exception to
// "append-only" for this table, bounded to: setting covered_to on a row where
// it is NULL. Closed windows are never edited or deleted, and the webhook that
// caused every transition is itself in the hash-chained spine, so the two
// records corroborate each other.
import type { Pool } from "pg";

export interface CoverageWindow {
  repo: string;
  installationId: number | null;
  coveredFrom: string;
  coveredTo: string | null;
  source: string;
}

export async function openCoverage(pool: Pool, repo: string, installationId: number | null, source: string): Promise<void> {
  // Idempotent on redelivery: if an open window already exists for this
  // repo+installation, don't open a second one.
  const existing = await pool.query(
    `SELECT id FROM coverage_windows WHERE repo = $1 AND installation_id IS NOT DISTINCT FROM $2 AND covered_to IS NULL`,
    [repo, installationId]
  );
  if (existing.rows.length > 0) return;
  await pool.query(
    `INSERT INTO coverage_windows (repo, installation_id, source) VALUES ($1, $2, $3)`,
    [repo, installationId, source]
  );
}

export async function closeCoverage(pool: Pool, opts: { repo?: string; installationId?: number | null }): Promise<number> {
  if (opts.repo != null) {
    const res = await pool.query(
      `UPDATE coverage_windows SET covered_to = now() WHERE repo = $1 AND covered_to IS NULL`,
      [opts.repo]
    );
    return res.rowCount ?? 0;
  }
  if (opts.installationId != null) {
    const res = await pool.query(
      `UPDATE coverage_windows SET covered_to = now() WHERE installation_id = $1 AND covered_to IS NULL`,
      [opts.installationId]
    );
    return res.rowCount ?? 0;
  }
  return 0;
}

/** All windows touching a repo, oldest first — the evidence package's coverage section. */
export async function coverageFor(pool: Pool, repo: string): Promise<CoverageWindow[]> {
  const { rows } = await pool.query(
    `SELECT repo, installation_id, covered_from, covered_to, source
     FROM coverage_windows WHERE repo = $1 ORDER BY covered_from`,
    [repo]
  );
  return rows.map((r) => ({
    repo: r.repo,
    installationId: r.installation_id == null ? null : Number(r.installation_id),
    coveredFrom: new Date(r.covered_from).toISOString(),
    coveredTo: r.covered_to ? new Date(r.covered_to).toISOString() : null,
    source: r.source,
  }));
}

// Map installation-lifecycle webhooks to window transitions. Called from the
// webhook route right after the spine logs the event — same delivery, so the
// chained event and the window transition always travel together.
export async function applyCoverageEvent(pool: Pool, eventName: string, payload: Record<string, any>): Promise<void> {
  const installationId: number | null = payload.installation?.id ?? null;

  if (eventName === "installation") {
    if (payload.action === "created") {
      const repos: Array<{ full_name?: string }> = payload.repositories ?? [];
      for (const r of repos) {
        if (r.full_name) await openCoverage(pool, r.full_name, installationId, "installation.created");
      }
    } else if (payload.action === "deleted") {
      await closeCoverage(pool, { installationId });
    }
    return;
  }

  if (eventName === "installation_repositories") {
    for (const r of (payload.repositories_added ?? []) as Array<{ full_name?: string }>) {
      if (r.full_name) await openCoverage(pool, r.full_name, installationId, "installation.repos_added");
    }
    for (const r of (payload.repositories_removed ?? []) as Array<{ full_name?: string }>) {
      if (r.full_name) await closeCoverage(pool, { repo: r.full_name });
    }
  }
}
