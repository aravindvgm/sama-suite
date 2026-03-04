/**
 * MIGRATION 023: Create sessions table for opaque refresh token management.
 *
 * Access tokens remain stateless JWTs.
 * Refresh tokens are opaque random strings stored as bcrypt hashes.
 * Sessions are revocable, tenant-scoped, and cascade-deleted with the user/org.
 */

CREATE TABLE sessions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id             UUID        NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  organization_id     UUID        NOT NULL REFERENCES organizations(id)   ON DELETE CASCADE,

  refresh_token_hash  TEXT        NOT NULL,

  ip_address          TEXT,
  user_agent          TEXT,

  expires_at          TIMESTAMP   NOT NULL,
  revoked_at          TIMESTAMP   NULL,

  created_at          TIMESTAMP   DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_org  ON sessions (organization_id);
