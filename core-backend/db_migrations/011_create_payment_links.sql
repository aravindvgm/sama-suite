-- =============================================================
-- 011_create_payment_links.sql
-- Secure pay-now link tokens for student fee payments.
-- =============================================================

CREATE TABLE IF NOT EXISTS payment_links (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_fee_id   UUID        NOT NULL,
  payment_id       UUID        NOT NULL,
  token            VARCHAR(64) NOT NULL UNIQUE,
  expires_at       TIMESTAMP   NOT NULL,
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_links_token          ON payment_links (token);
CREATE INDEX IF NOT EXISTS idx_payment_links_organization   ON payment_links (organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_student_fee    ON payment_links (student_fee_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_expires_at     ON payment_links (expires_at);
