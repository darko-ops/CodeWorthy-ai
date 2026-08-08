-- V0.1 — canonical encoding v2: make the chain recomputable outside SQL.
--
-- v1's canonical bytes include extract(epoch from ts)::text — Postgres numeric
-- formatting a non-SQL verifier would have to reproduce digit-for-digit. v2
-- contributes the timestamp as INTEGER EPOCH-MICROSECONDS instead (timestamptz
-- carries microsecond precision, so the conversion is exact — no rounding, no
-- float formatting). Everything else is unchanged from v1: same field order,
-- same 0x1f separator, payload as Postgres-normalized jsonb text (whose exact
-- bytes are covered by the hash itself, so an external verifier receives them
-- in the evidence package and never has to re-derive jsonb normalization).
--
-- VERSIONED, NEVER REWRITTEN: existing rows keep canon_version = 1 and keep
-- verifying under audit_canonical (v1). Only new rows are stamped v2 by the
-- trigger. A canonical change must never orphan history — the verifier
-- (server-side tamper.ts today, the standalone CLI in V3) recomputes each row
-- under the version it was written with. The full byte-level contract lives in
-- docs/spec/canonical-encoding.md, with cross-implementation test vectors.

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS canon_version smallint NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION audit_canonical_v2(
    p_id bigint, p_ts timestamptz, p_installation_id bigint,
    p_repo text, p_event_type text, p_actor text, p_payload jsonb, p_plain text
) RETURNS bytea AS $$
    SELECT convert_to(
        concat_ws(chr(31),
            p_id::text,
            (extract(epoch from p_ts) * 1000000)::bigint::text,
            coalesce(p_installation_id::text, ''),
            p_repo, p_event_type,
            coalesce(p_actor, ''),
            p_payload::text,
            p_plain
        ), 'UTF8');
$$ LANGUAGE sql IMMUTABLE;

-- Same trigger, now writing v2 rows. CREATE OR REPLACE swaps the body; the
-- trigger binding from 0002 is untouched, as is the advisory-lock serialization.
CREATE OR REPLACE FUNCTION audit_events_hash_chain() RETURNS trigger AS $$
DECLARE
    prev bytea;
BEGIN
    PERFORM pg_advisory_xact_lock(748301);  -- one linear chain, no forks
    SELECT row_hash INTO prev FROM audit_events ORDER BY id DESC LIMIT 1;
    NEW.canon_version := 2;
    NEW.prev_hash := prev;
    NEW.row_hash := digest(
        coalesce(prev, '\x'::bytea) ||
        audit_canonical_v2(NEW.id, NEW.ts, NEW.installation_id, NEW.repo,
                           NEW.event_type, NEW.actor, NEW.payload, NEW.plain_english),
        'sha256');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
