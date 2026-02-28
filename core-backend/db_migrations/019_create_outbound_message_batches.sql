-- ============================================================
-- MIGRATION: Create outbound_message_batches table
--
-- Purpose: Audit ledger and safety guardrail for bulk outbound
-- messaging (WhatsApp campaigns, announcements, fee reminders).
--
-- Safety thresholds (configurable via ENV):
--   BATCH_MAX_RECIPIENTS  — default 500  (recipient_count)
--   BATCH_MAX_COST_INR    — default 2000 (estimated_cost in ₹)
--
-- When either threshold is exceeded, API sends require an explicit
-- confirmationToken: "CONFIRM_SEND" before dispatch proceeds.
-- Workers abort with a structured log entry — no sends are made.
--
-- Status state machine:
--   PENDING_CONFIRMATION → RUNNING → COMPLETED | FAILED
--   PENDING_CONFIRMATION → ABORTED (worker threshold exceeded)
-- ============================================================

CREATE TABLE outbound_message_batches (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID,                          -- NULL for cross-org worker batches
  batch_type       VARCHAR(50)   NOT NULL,        -- CAMPAIGN | ANNOUNCEMENT | FEE_REMINDER | BIRTHDAY
  recipient_count  INT           NOT NULL DEFAULT 0,
  estimated_cost   NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  status           VARCHAR(30)   NOT NULL DEFAULT 'PENDING',
  created_at       TIMESTAMP     NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP     NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_batch_status CHECK (
    status IN ('PENDING', 'PENDING_CONFIRMATION', 'RUNNING', 'COMPLETED', 'FAILED', 'ABORTED')
  ),
  CONSTRAINT chk_recipient_count CHECK (recipient_count >= 0),
  CONSTRAINT chk_estimated_cost  CHECK (estimated_cost  >= 0)
);

CREATE INDEX idx_outbound_batches_org
  ON outbound_message_batches (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX idx_outbound_batches_status
  ON outbound_message_batches (status, created_at DESC);

CREATE INDEX idx_outbound_batches_created
  ON outbound_message_batches (created_at DESC);

COMMENT ON TABLE outbound_message_batches IS
  'Audit ledger for all bulk outbound message sends. '
  'Batches exceeding BATCH_MAX_RECIPIENTS or BATCH_MAX_COST_INR thresholds '
  'are blocked until an explicit CONFIRM_SEND token is provided (API sends) '
  'or aborted immediately (worker sends).';

COMMENT ON COLUMN outbound_message_batches.estimated_cost IS
  'Pre-send cost estimate in INR, calculated as recipient_count × WHATSAPP_COST_PER_MSG. '
  'Used for threshold enforcement. Actual cost may vary by gateway pricing.';

COMMENT ON COLUMN outbound_message_batches.status IS
  'PENDING → PENDING_CONFIRMATION when threshold exceeded and no token. '
  'PENDING → RUNNING when confirmed or within threshold. '
  'RUNNING → COMPLETED | FAILED after dispatch. '
  'ABORTED when a worker batch exceeds thresholds (no send made).';
