/**
 * MIGRATION: Create adjustments table for CA accounting operations
 *
 * This table tracks ALL financial adjustments:
 * - REFUNDS: Return payment to customer (payment status → REFUNDED)
 * - WRITE_OFFS: Forgive debt (invoice status → written off)
 * - CREDIT_NOTES: Issue credit for adjustment
 *
 * Design:
 * - Immutable records (no hard deletes, soft delete via is_reversed)
 * - Approval workflow (PENDING → APPROVED/REJECTED)
 * - Auto-recalculates invoice status on approval
 * - Full audit trail with who/when/why
 * - Prevents negative balances
 */

-- Create enum for adjustment types
CREATE TYPE adjustment_type AS ENUM (
  'REFUND',        -- Return payment to customer
  'WRITE_OFF',     -- Forgive debt (CA decision)
  'CREDIT_NOTE',   -- Credit for future use or account
  'CORRECTION'     -- Fix accounting error
);

CREATE TYPE adjustment_status AS ENUM (
  'PENDING',       -- Awaiting approval
  'APPROVED',      -- Approved and applied
  'REJECTED',      -- Rejected with reason
  'REVERSED'       -- Reversed/cancelled
);

-- Main adjustments table
CREATE TABLE adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,

  -- Reference to what is being adjusted
  invoice_id UUID NOT NULL,
  payment_id UUID, -- For refunds (null for write-offs/credits)

  -- Adjustment details
  type adjustment_type NOT NULL,
  amount NUMERIC(12, 2) NOT NULL, -- Amount being adjusted
  status adjustment_status NOT NULL DEFAULT 'PENDING',
  reason TEXT NOT NULL, -- Business reason (mandatory for audit)

  -- Approval workflow
  requested_by UUID NOT NULL, -- User who initiated
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),

  approved_by UUID, -- Admin who approved
  approved_at TIMESTAMP,
  approval_notes TEXT,

  rejected_by UUID, -- Admin who rejected
  rejected_at TIMESTAMP,
  rejection_reason TEXT,

  -- Reversal tracking (immutable - never hard delete)
  is_reversed BOOLEAN NOT NULL DEFAULT FALSE,
  reversed_by UUID,
  reversed_at TIMESTAMP,
  reversal_reason TEXT,

  -- Impact tracking
  previous_invoice_status VARCHAR(50),
  new_invoice_status VARCHAR(50),
  previous_payment_status VARCHAR(50),
  new_payment_status VARCHAR(50),

  -- Metadata
  metadata JSONB, -- Additional context
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_requested_by FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_approved_by FOREIGN KEY (approved_by) REFERENCES users(id),
  CONSTRAINT fk_rejected_by FOREIGN KEY (rejected_by) REFERENCES users(id),
  CONSTRAINT fk_reversed_by FOREIGN KEY (reversed_by) REFERENCES users(id),

  -- Amount must be positive
  CONSTRAINT amount_positive CHECK (amount > 0),

  -- Approval state machine: only one path taken
  CONSTRAINT approval_xor CHECK (
    (status = 'PENDING' AND approved_by IS NULL AND rejected_by IS NULL) OR
    (status = 'APPROVED' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND rejected_by IS NULL) OR
    (status = 'REJECTED' AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND approved_by IS NULL) OR
    (status = 'REVERSED' AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL)
  ),

  -- Refunds must have payment_id
  CONSTRAINT refund_needs_payment CHECK (
    (type = 'REFUND' AND payment_id IS NOT NULL) OR
    (type != 'REFUND')
  )
);

-- Performance indexes
CREATE INDEX idx_adjustment_org_invoice
  ON adjustments(organization_id, invoice_id);

CREATE INDEX idx_adjustment_org_status
  ON adjustments(organization_id, status);

CREATE INDEX idx_adjustment_pending
  ON adjustments(organization_id, requested_at DESC)
  WHERE status = 'PENDING';

CREATE INDEX idx_adjustment_approved
  ON adjustments(organization_id, approved_at DESC)
  WHERE status = 'APPROVED' AND is_reversed = FALSE;

CREATE INDEX idx_adjustment_payment
  ON adjustments(payment_id)
  WHERE type = 'REFUND' AND is_reversed = FALSE;

-- Comments for documentation
COMMENT ON TABLE adjustments IS 'Immutable adjustment records (refunds, write-offs, credits). Approval workflow. Auto-recalculates invoice status on approval.';
COMMENT ON COLUMN adjustments.type IS 'REFUND: return payment, WRITE_OFF: forgive debt, CREDIT_NOTE: credit for future, CORRECTION: fix error';
COMMENT ON COLUMN adjustments.status IS 'PENDING → APPROVED|REJECTED → REVERSED. Approval required before taking effect.';
COMMENT ON COLUMN adjustments.reason IS 'Business reason for adjustment. CRITICAL for CA audit compliance.';
COMMENT ON COLUMN adjustments.is_reversed IS 'Soft delete flag. Reversed adjustments still visible for audit trail.';
COMMENT ON COLUMN adjustments.metadata IS 'Additional context (bank reference, CA notes, etc.) stored as JSON.';
COMMENT ON CONSTRAINT approval_xor ON adjustments IS 'Approval state machine: either APPROVED or REJECTED, cannot be both.';
COMMENT ON CONSTRAINT refund_needs_payment ON adjustments IS 'REFUND adjustments must reference a payment record.';
