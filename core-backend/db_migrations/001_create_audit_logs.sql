/**
 * MIGRATION: Create audit_logs table for comprehensive financial audit trail
 *
 * This table stores ALL financial transactions and state changes for:
 * - Complete compliance with CA auditing requirements
 * - Non-repudiation of financial transactions
 * - State change tracking with who/when/why
 * - Forensic analysis capabilities
 */

-- Create enum for entity types (extensible for future entities)
CREATE TYPE audit_entity_type AS ENUM ('INVOICE', 'PAYMENT', 'ADJUSTMENT');
CREATE TYPE audit_action_type AS ENUM ('CREATE', 'UPDATE', 'SEND', 'VERIFY', 'REJECT', 'CANCEL', 'REFUND', 'WRITE_OFF');

-- Main audit logs table
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,

  -- Entity being audited
  entity_type audit_entity_type NOT NULL,
  entity_id UUID NOT NULL,

  -- Action performed
  action audit_action_type NOT NULL,

  -- Who made the change
  changed_by UUID NOT NULL,
  user_role VARCHAR(50), -- ORG_ADMIN, ORG_MANAGER, ORG_USER, SUPER_ADMIN (snaphot)
  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- State changes (JSONB for flexibility)
  previous_state JSONB, -- NULL for CREATE actions
  new_state JSONB,      -- Full new state

  -- Business context
  reason TEXT, -- Why the change was made (required for some actions)

  -- Security & compliance
  ip_address VARCHAR(45), -- IPv4 or IPv6
  user_agent TEXT, -- Browser/client info

  -- Metadata for forensic analysis
  request_id VARCHAR(255), -- Correlation ID for request tracing

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_user FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- Performance indexes for CA audit queries
CREATE INDEX idx_audit_org_entity
  ON audit_logs(organization_id, entity_id, action);

CREATE INDEX idx_audit_org_timestamp
  ON audit_logs(organization_id, changed_at DESC);

CREATE INDEX idx_audit_user
  ON audit_logs(changed_by, changed_at DESC);

CREATE INDEX idx_audit_entity_timeline
  ON audit_logs(entity_type, entity_id, changed_at ASC);

-- Full-text search on reason/notes for investigation
CREATE INDEX idx_audit_reason
  ON audit_logs USING GIN (to_tsvector('english', reason));

-- Prevent accidental modifications (read-only table)
-- Note: In production, this could be enforced with database triggers
GRANT SELECT ON audit_logs TO PUBLIC;
GRANT INSERT ON audit_logs TO authenticated_role;
REVOKE DELETE, UPDATE ON audit_logs FROM PUBLIC;

-- Add comment for documentation
COMMENT ON TABLE audit_logs IS 'Complete financial audit trail. All invoice, payment, and adjustment transactions logged. Read-only for compliance.';
COMMENT ON COLUMN audit_logs.previous_state IS 'JSON snapshot of entity before change. NULL for CREATE actions.';
COMMENT ON COLUMN audit_logs.new_state IS 'JSON snapshot of entity after change. Always populated.';
COMMENT ON COLUMN audit_logs.reason IS 'Business reason for change. Critical for CA audit compliance.';
COMMENT ON COLUMN audit_logs.ip_address IS 'IP address of requester for security audit trail.';
COMMENT ON COLUMN audit_logs.request_id IS 'Unique request identifier for tracing related logs.';
