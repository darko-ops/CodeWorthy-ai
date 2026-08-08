-- V0.4 — coverage windows: WHEN was CodeWorthy actually watching each repo?
--
-- The audit spine records what happened while we were listening. A completeness
-- claim ("every change in the period is in the log") is only honest over the
-- intervals we were actually installed — this table states those intervals
-- explicitly, so the evidence package says "complete for exactly these windows"
-- and gaps are DECLARED rather than discovered by an auditor.
--
-- A window opens when a repo comes under stewardship (app installed / repo
-- added to the installation) and closes when it leaves (uninstalled / repo
-- removed). covered_to IS NULL = still covered. Windows are never deleted or
-- edited after closing — like the spine, coverage history only appends.

CREATE TABLE coverage_windows (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    repo            text NOT NULL,               -- "owner/name"
    installation_id bigint,                      -- which installation covered it
    covered_from    timestamptz NOT NULL DEFAULT now(),
    covered_to      timestamptz,                 -- NULL = coverage ongoing
    source          text NOT NULL                -- 'installation.created' | 'installation.repos_added' | backfill note
);

CREATE INDEX coverage_windows_repo_idx ON coverage_windows (repo, covered_from);
CREATE INDEX coverage_windows_open_idx ON coverage_windows (installation_id) WHERE covered_to IS NULL;
