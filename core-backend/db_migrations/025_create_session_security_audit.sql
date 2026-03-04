-- ============================================================
-- MIGRATION 025: Session security audit + session table hardening
-- ============================================================
--
-- Part A: Extend sessions table
--   - token_id: UUID embedded in the refresh token so the correct
--     session row can be located in O(1) via indexed lookup and
--     locked with SELECT ... FOR UPDATE before any bcrypt work.
--     Without this, row-level locking is impossible (bcrypt hashes
--     cannot be indexed for equality).
--   - device_label: best-effort human-readable device description
--     derived from User-Agent at session creation time.
--
-- Part B: Create session_security_audit table
--   Append-only log for high-severity session events.
--   Written fire-and-forget — never blocks the auth flow.
-- ============================================================


-- ── Part A: Extend sessions ───────────────────────────────────────────────────

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS token_id     UUID  NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS device_label TEXT  NULL;

-- Unique index enables O(1) lookup by token_id.
-- Also enforces the invariant that each refresh token maps to exactly one session.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_id ON sessions (token_id);


-- ── Part B: session_security_audit ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_security_audit (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL,
  user_id         UUID        NOT NULL,
  ip_address      TEXT        NULL,
  reason          TEXT        NOT NULL CHECK (reason IN (
                                'refresh_reuse_detected',
                                'concurrent_session_evicted',
                                'admin_session_revocation'
                              )),
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ssa_org        ON session_security_audit (organization_id);
CREATE INDEX idx_ssa_user       ON session_security_audit (user_id);
CREATE INDEX idx_ssa_created_at ON session_security_audit (created_at);

COMMENT ON TABLE session_security_audit IS
  'Append-only log of high-severity session security events. '
  'Written asynchronously — never blocks the auth response path.';

COMMENT ON COLUMN session_security_audit.reason IS
  'refresh_reuse_detected     – a rotated/revoked refresh token was re-presented; all sessions revoked. '
  'concurrent_session_evicted – oldest session evicted to enforce the per-user/org session cap. '
  'admin_session_revocation   – admin explicitly revoked all sessions for a user.';
