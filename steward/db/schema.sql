-- CodeWorthy Steward — audit storage (SOC 2 seed).
--
-- Append-only is enforced at the GRANT level, not by convention: the app's
-- database role can INSERT and SELECT, and structurally cannot UPDATE, DELETE,
-- or TRUNCATE. Run this file as the database owner; run the app as
-- steward_app.
--
-- Each row extends a per-repository hash chain (prev_hash -> hash), making
-- the log tamper-evident: rewriting any historical row breaks every hash
-- after it. Verify with: node src/audit.mjs --verify --repo <owner/repo>

CREATE TABLE IF NOT EXISTS audit_events (
  id              bigserial PRIMARY KEY,
  installation_id bigint      NOT NULL,
  repo            text        NOT NULL,   -- "owner/name"
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor           text        NOT NULL,   -- GitHub login or "steward"
  event_type      text        NOT NULL,   -- e.g. direct_push_to_default, protection_applied
  payload         jsonb       NOT NULL,
  plain_english   text        NOT NULL,   -- the sentence a non-engineer (or auditor) reads
  prev_hash       text        NOT NULL,   -- hash of the previous row in this repo's chain ("genesis" for the first)
  hash            text        NOT NULL    -- sha256(prev_hash + canonical event fields)
);

CREATE INDEX IF NOT EXISTS audit_events_repo_id_idx ON audit_events (repo, id);

-- The app role: append-only by construction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'steward_app') THEN
    CREATE ROLE steward_app LOGIN;
  END IF;
END $$;

REVOKE ALL ON audit_events FROM steward_app;
GRANT INSERT, SELECT ON audit_events TO steward_app;
GRANT USAGE, SELECT ON SEQUENCE audit_events_id_seq TO steward_app;
