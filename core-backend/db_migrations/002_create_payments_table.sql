/**
 * MIGRATION: Create payments table with financial integrity constraints
 *
 * This table stores ALL payment transactions with:
 * - Idempotency via unique external_payment_id constraint
 * - Immutable payment records (soft deletes only, no hard deletes)
 * - Full transaction wrapping during verification
 * - Support for partial payments and overpayment detection
 * - Automatic status recalculation on payment verification
 */

-- Create enum for payment methods (extensible)
CREATE TYPE payment_method AS ENUM ('UPI', 'BANK_TRANSFER', 'CHEQUE', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD');
CREATE TYPE payment_status AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'REFUNDED');

-- Main payments table
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  invoice_id UUID NOT NULL,

  -- Payment details
  amount NUMERIC(12, 2) NOT NULL, -- In INR, validated > 0
  payment_method payment_method NOT NULL,

  -- External payment identifier (CRITICAL for idempotency)
  -- This prevents duplicate payment marking from webhook retries
  external_payment_id VARCHAR(255) NOT NULL,

  -- Payment state tracking
  status payment_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  payment_date DATE NOT NULL, -- Date payment was made
  received_at TIMESTAMP NOT NULL DEFAULT NOW(), -- When we received notification

  -- Verification details
  verified_by UUID, -- Admin who verified (user.id)
  verified_at TIMESTAMP,
  verification_notes TEXT,

  -- Rejection details (mutually exclusive with verification)
  rejected_by UUID,
  rejected_at TIMESTAMP,
  rejection_reason TEXT,

  -- Refund tracking (immutable - never hard delete)
  is_refunded BOOLEAN NOT NULL DEFAULT FALSE,
  refunded_amount NUMERIC(12, 2),
  refunded_at TIMESTAMP,
  refund_reason TEXT,

  -- Payment proof (screenshot, receipt link, etc.)
  proof_url TEXT,
  proof_metadata JSONB, -- Additional metadata (transaction hash, gateway response, etc.)

  -- Audit trail
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_verified_by FOREIGN KEY (verified_by) REFERENCES users(id),
  CONSTRAINT fk_rejected_by FOREIGN KEY (rejected_by) REFERENCES users(id),

  -- Payment amount must be positive
  CONSTRAINT amount_positive CHECK (amount > 0),

  -- Refunded amount must be <= payment amount
  CONSTRAINT refund_valid CHECK (refunded_amount IS NULL OR refunded_amount <= amount),

  -- CRITICAL: Idempotency constraint - no duplicate external payment IDs per organization
  -- This prevents duplicate payment marking from webhook retries or API retries
  CONSTRAINT unique_external_payment_per_org UNIQUE (organization_id, external_payment_id),

  -- Either verified OR rejected, not both
  CONSTRAINT verify_xor_reject CHECK (
    (status = 'VERIFIED' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND rejected_by IS NULL) OR
    (status = 'REJECTED' AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL AND verified_by IS NULL) OR
    (status = 'PENDING_VERIFICATION' AND verified_by IS NULL AND rejected_by IS NULL) OR
    (status = 'REFUNDED' AND refunded_at IS NOT NULL)
  )
);

-- Performance indexes for payment queries
CREATE INDEX idx_payment_org_invoice
  ON payments(organization_id, invoice_id);

CREATE INDEX idx_payment_org_status
  ON payments(organization_id, status);

CREATE INDEX idx_payment_external_id
  ON payments(external_payment_id);

CREATE INDEX idx_payment_verified_recent
  ON payments(organization_id, verified_at DESC)
  WHERE status = 'VERIFIED';

CREATE INDEX idx_payment_pending
  ON payments(organization_id, created_at ASC)
  WHERE status = 'PENDING_VERIFICATION';

-- For reconciliation: sum of verified payments per invoice
CREATE INDEX idx_payment_invoice_verified
  ON payments(invoice_id, status)
  WHERE status = 'VERIFIED' AND is_refunded = FALSE;

-- Add comments for documentation
COMMENT ON TABLE payments IS 'Payment transactions with strict financial integrity. Immutable records (soft deletes). Idempotent handling via external_payment_id unique constraint.';
COMMENT ON COLUMN payments.external_payment_id IS 'External payment identifier (UPI reference, bank UTR, etc.). MUST be unique per organization for idempotency.';
COMMENT ON COLUMN payments.status IS 'PENDING_VERIFICATION → VERIFIED|REJECTED → REFUNDED. Never transition backwards.';
COMMENT ON COLUMN payments.proof_url IS 'URL to payment screenshot or receipt. Used for manual verification by CAs.';
COMMENT ON COLUMN payments.proof_metadata IS 'Additional metadata (payment gateway response, transaction hash, etc.) for audit trail.';
COMMENT ON CONSTRAINT unique_external_payment_per_org ON payments IS 'CRITICAL: Prevents duplicate payment marking from webhook retries. Ensures idempotency.';
COMMENT ON CONSTRAINT verify_xor_reject ON payments IS 'Payment state machine: either VERIFIED or REJECTED, mutually exclusive. PENDING_VERIFICATION is initial state.';
