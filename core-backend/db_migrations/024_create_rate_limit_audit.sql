-- ============================================================
-- MIGRATION 024: Create rate_limit_audit table
-- ============================================================
-- Stores fire-and-forget records of rate limit breaches.
-- Rows are written asynchronously after a 429 is returned.
-- organization_id and user_id are nullable: unauthenticated
-- requests (blocked at the IP layer) have no org/user context.
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limit_audit (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NULL,
  user_id          UUID        NULL,
  ip_address       VARCHAR(45) NOT NULL,
  route            TEXT        NOT NULL,
  method           VARCHAR(10) NOT NULL,
  rate_limit_type  VARCHAR(10) NOT NULL CHECK (rate_limit_type IN ('ip', 'user', 'login')),
  user_agent       TEXT        NOT NULL DEFAULT '',
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Lookup by org/user for breach history queries
CREATE INDEX idx_rla_org        ON rate_limit_audit (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_rla_user       ON rate_limit_audit (user_id)         WHERE user_id IS NOT NULL;

-- IP-based forensics
CREATE INDEX idx_rla_ip         ON rate_limit_audit (ip_address);

-- Time-range queries for dashboards / retention sweeps
CREATE INDEX idx_rla_created_at ON rate_limit_audit (created_at);

COMMENT ON TABLE rate_limit_audit IS
  'Append-only log of rate limit breaches. Written fire-and-forget after 429 responses. Never blocks the request path.';
