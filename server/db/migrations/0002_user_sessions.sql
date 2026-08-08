-- Browser sign-in sessions for the dashboard ("Sign in with GitHub").
--
-- The browser only ever holds the opaque `id` (a random token). The GitHub
-- user-to-server access token is stored HERE, server-side, and never leaves the
-- backend — so an XSS on the SPA can't exfiltrate a GitHub token, and revoking
-- a session is a single DELETE.
--
-- Not append-only (unlike audit_events): sessions are created on sign-in and
-- deleted on sign-out or expiry. Distinct concern, distinct table.

CREATE TABLE user_sessions (
    id           text PRIMARY KEY,            -- opaque random id handed to the browser
    gh_login     text NOT NULL,               -- github login of the signed-in user
    gh_name      text,                        -- display name (may be null on github)
    gh_avatar    text,                        -- avatar url
    gh_token     text NOT NULL,               -- user-to-server token (server-side only)
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);

-- Sweep index: expired sessions are pruned lazily on lookup and can be GC'd.
CREATE INDEX user_sessions_expires_idx ON user_sessions (expires_at);
