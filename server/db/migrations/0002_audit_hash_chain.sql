-- M1.5 — tamper-EVIDENCE on the audit spine.
--
-- M1 made audit_events append-only (a least-privilege grant + a trigger blocking
-- UPDATE/DELETE). That stops the app and ordinary roles from mutating history.
-- It does NOT stop a DB superuser who runs `ALTER TABLE ... DISABLE TRIGGER`
-- and then edits a row. M1.5 makes such tampering DETECTABLE:
--
--   1. A hash chain, computed in the DB on every insert, so it binds EVERY
--      writer (not just the app). Each row commits to the previous row's hash;
--      editing, deleting, or reordering any row breaks the chain and the
--      verifier finds the exact break.
--   2. External WORM anchoring (src/audit/tamper.ts) periodically pins the chain
--      head to write-once storage OUTSIDE the DB. That closes the last hole: an
--      insider who disables the trigger, rewrites every row, AND recomputes the
--      whole chain to stay internally consistent is still caught, because the
--      head no longer matches what was already anchored.
--
-- All additive: existing rows and the M1 table contract are untouched. Writes
-- through appendAuditEvent need no change — the trigger fills the new columns.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash bytea;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS row_hash  bytea;

-- The canonical byte-representation of a row. ONE source of truth, shared by the
-- chain trigger (below) and the verifier's recompute query — so the two can
-- never drift. Field separator is a control char (0x1f, "unit separator") that
-- won't collide with content; jsonb::text is normalized (stable key order), so
-- the payload contributes deterministically.
CREATE OR REPLACE FUNCTION audit_canonical(
    p_id bigint, p_ts timestamptz, p_installation_id bigint,
    p_repo text, p_event_type text, p_actor text, p_payload jsonb, p_plain text
) RETURNS bytea AS $$
    SELECT convert_to(
        concat_ws(chr(31),
            p_id::text,
            extract(epoch from p_ts)::text,
            coalesce(p_installation_id::text, ''),
            p_repo, p_event_type,
            coalesce(p_actor, ''),
            p_payload::text,
            p_plain
        ), 'UTF8');
$$ LANGUAGE sql IMMUTABLE;

-- Compute row_hash = sha256(prev_hash || canonical(row)) on insert. An advisory
-- lock serializes appends so the chain is strictly linear (audit volume is low;
-- a serialized append is well within budget). NULL prev_hash marks the genesis
-- row (or the first row after a TRUNCATE).
CREATE OR REPLACE FUNCTION audit_events_hash_chain() RETURNS trigger AS $$
DECLARE
    prev bytea;
BEGIN
    PERFORM pg_advisory_xact_lock(748301);  -- one linear chain, no forks
    SELECT row_hash INTO prev FROM audit_events ORDER BY id DESC LIMIT 1;
    NEW.prev_hash := prev;
    NEW.row_hash := digest(
        coalesce(prev, '\x'::bytea) ||
        audit_canonical(NEW.id, NEW.ts, NEW.installation_id, NEW.repo,
                        NEW.event_type, NEW.actor, NEW.payload, NEW.plain_english),
        'sha256');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_chain
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_hash_chain();
