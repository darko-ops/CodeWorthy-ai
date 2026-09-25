-- The chain's linearity guarantee, made true.
--
-- 0002 serialized the hash computation with an advisory lock and the spec then
-- claimed the chain was "strictly linear — no forks". It wasn't, and production
-- proved it: a fork at rows 1378/1379, where 1379 has two children and 1378's
-- hash is referenced by nothing.
--
-- Why the lock wasn't enough. The id is an IDENTITY column, so `nextval` runs
-- when the tuple is BUILT — before a BEFORE ... FOR EACH ROW trigger fires.
-- (That ordering is why audit_events_hash_chain() can read NEW.id at all.) The
-- lock therefore serializes hashing but cannot govern id assignment. Two
-- concurrent appends can take ids in one order and the lock in the other, and
-- because the row trigger picks its predecessor with ORDER BY id DESC, the
-- LOWER-id row then chains onto the HIGHER-id row. A later append chains onto
-- that same higher id, and the chain branches.
--
-- The fix is to take the lock earlier than any tuple exists. A statement-level
-- BEFORE INSERT trigger fires once, before the statement processes any row and
-- therefore before nextval — so id order and chain order become the same order
-- again, which is precisely what the spec says they are.
--
-- Additive: no data is read, written, or backfilled. The existing row-level
-- trigger is unchanged; its own lock acquisition is a no-op once this one holds
-- it in the same transaction.
--
-- NOTE on the existing fork: it is NOT repaired here, and cannot be. Making
-- 1378 linear again means recomputing hashes, which is rewriting history — the
-- one thing this table exists to prevent. The verifier is taught to report it
-- honestly instead (see src/audit/tamper.ts).

CREATE OR REPLACE FUNCTION audit_events_serialize_append() RETURNS trigger AS $$
BEGIN
    -- Same lock id as the row trigger: one chain, one queue. Taken here so the
    -- sequence is drawn inside it rather than before it.
    PERFORM pg_advisory_xact_lock(748301);
    RETURN NULL;  -- statement-level BEFORE triggers ignore the return value
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_serialize ON audit_events;
CREATE TRIGGER audit_events_serialize
    BEFORE INSERT ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_events_serialize_append();
