-- Session secrets stop being legible in the database.
--
-- 0002 reasoned that the GitHub token "never leaves the backend", so an XSS on
-- the SPA cannot exfiltrate it. That is true, and it is why the browser holds an
-- opaque id instead of a token. It is also a different threat from disclosure of
-- the DATABASE — a backup, a read-only connection string, a Neon console
-- session, a query in a log — against which this table offered nothing: the
-- GitHub user-to-server token and the replayable bearer both sat here in clear.
--
-- After this migration:
--   id_sha256     sha256 of the bearer the browser holds. Plain hash, no key:
--                 the id is 32 bytes of randomBytes, so there is nothing to
--                 brute-force and keyed hashing would add ceremony, not
--                 security.
--   gh_token_enc  AES-256-GCM under STEWARD_TOKEN_KEY, which lives in the
--                 platform's secret store and never in this database. Holding
--                 the database alone now yields nothing usable.
--
-- Existing rows are DELETED rather than migrated. Their contents cannot be
-- re-encrypted without the plaintext, and re-writing them as ciphertext would
-- mean the old cleartext had to be read out first. Sessions are disposable by
-- design (7-day TTL, re-login is one click), so everyone signs in once more.
--
-- The columns are RENAMED rather than reused. A column still called `gh_token`
-- holding ciphertext is a trap for the next person who writes `SELECT gh_token`
-- and gets something that looks like a value; the name should say what is
-- actually in it. Both are `text`, so nothing changes type.

DELETE FROM user_sessions;

ALTER TABLE user_sessions RENAME COLUMN id TO id_sha256;
ALTER TABLE user_sessions RENAME COLUMN gh_token TO gh_token_enc;

COMMENT ON COLUMN user_sessions.id_sha256 IS
  'sha256(bearer). The raw bearer exists only in the browser and in process memory.';
COMMENT ON COLUMN user_sessions.gh_token_enc IS
  'AES-256-GCM(v1) under STEWARD_TOKEN_KEY. Never a plaintext GitHub token.';
