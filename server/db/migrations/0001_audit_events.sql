-- The audit spine. Everything the Steward App does logs through here: one
-- append-only, plain-language record serving both the founder ("what happened
-- this week") and a SOC 2 auditor ("prove your change control").
--
-- Append-only is enforced TWO ways (defense in depth):
--   1. Least-privilege grant (run out of band for the app's DB role) — the app
--      never holds UPDATE/DELETE:
--        GRANT INSERT, SELECT ON audit_events TO steward_app;   -- nothing else
--   2. A schema-level trigger that blocks UPDATE/DELETE regardless of role, so
--      immutability holds even if a superuser connection is misused.
--
-- Deferred to M1.5 (gated on a design partner asking for tamper-evidence):
-- prev_hash/hash chain columns + nightly WORM anchoring. The columns can be
-- added additively without touching this table's contract.

CREATE TABLE audit_events (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts              timestamptz NOT NULL DEFAULT now(),
    installation_id bigint,
    repo            text NOT NULL,              -- "owner/name"
    event_type      text NOT NULL,             -- e.g. "installation.created", "push.direct_to_default"
    actor           text,                      -- github login, when known
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- structured detail
    plain_english   text NOT NULL              -- the human sentence, written at event time
);

CREATE INDEX audit_events_repo_ts_idx ON audit_events (repo, ts DESC);
CREATE INDEX audit_events_installation_idx ON audit_events (installation_id, ts DESC);

-- Immutability: append-only at the schema level.
CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_events is append-only (% is blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_no_mutation
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();

-- The plain-language change log. One view, two audiences.
CREATE VIEW audit_changelog AS
    SELECT ts, repo, actor, event_type, plain_english
    FROM audit_events
    ORDER BY ts DESC;
