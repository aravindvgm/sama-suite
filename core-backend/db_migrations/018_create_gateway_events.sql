-- ============================================================
-- MIGRATION: Create gateway_events table
--
-- Purpose: DB-level idempotency for inbound payment webhooks.
--
-- Design decisions:
--   • UNIQUE(gateway, gateway_event_id) — not just gateway_event_id,
--     because different gateways can generate overlapping event IDs.
--   • ON CONFLICT DO NOTHING at the application layer means a duplicate
--     INSERT returns rowCount=0 without error, letting the handler
--     return 200 immediately without touching payment state.
--   • organization_id is NOT NULL and is always derived from the DB
--     payment record — never trusted from the webhook body.
--   • payload JSONB stores the full raw event for audit / replay.
--   • No soft-delete — events are append-only and immutable.
-- ============================================================

CREATE TABLE gateway_events (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway          VARCHAR(50)   NOT NULL,
  gateway_event_id VARCHAR(255)  NOT NULL,
  organization_id  UUID          NOT NULL,
  received_at      TIMESTAMP     NOT NULL DEFAULT NOW(),
  payload          JSONB         NOT NULL,

  -- Idempotency constraint: same gateway can never have two entries
  -- for the same event ID. Different gateways are allowed to share IDs.
  CONSTRAINT uq_gateway_event UNIQUE (gateway, gateway_event_id)
);

-- Fast replay-detection lookup (covered by the unique index above,
-- added as a named index for explicit query planning visibility)
CREATE INDEX idx_gateway_events_org
  ON gateway_events (organization_id);

CREATE INDEX idx_gateway_events_received
  ON gateway_events (received_at DESC);

COMMENT ON TABLE gateway_events IS
  'Idempotency ledger for inbound payment webhook events. '
  'One row per (gateway, event_id) pair — enforced by unique constraint. '
  'Duplicate inserts are silently ignored (ON CONFLICT DO NOTHING). '
  'organization_id is always sourced from the payments table, never the webhook body.';

COMMENT ON COLUMN gateway_events.gateway_event_id IS
  'Gateway-assigned event identifier (e.g. Razorpay evt_xxx, Stripe evt_xxx). '
  'Unique per gateway. Used to detect and reject replayed webhook calls.';

COMMENT ON COLUMN gateway_events.payload IS
  'Full raw webhook payload stored for audit trail and potential replay. '
  'Never contains decrypted secrets.';
