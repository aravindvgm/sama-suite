/**
 * MIGRATION 021: Subscription Billing Foundation
 *
 * Tables:
 *   tenant_plans          — plan catalogue with flexible JSONB limits/features
 *   tenant_subscriptions  — org ↔ plan binding with extended lifecycle states
 *   usage_events          — append-only raw metric log
 *   usage_summary_period  — pre-aggregated period summaries (background job target)
 *   billing_ledger        — payment / charge records per org
 *
 * Design notes:
 *   - limits_json / features_json replace fixed columns for forward compatibility.
 *   - usage_summary_period has a UNIQUE key (org, metric, period_start) so a
 *     background aggregation worker can upsert with ON CONFLICT DO UPDATE.
 *   - billing_ledger is append-only; no UPDATE/DELETE in application code.
 */

BEGIN;

-- ── 1. tenant_plans ───────────────────────────────────────────────────────────
CREATE TABLE tenant_plans (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT          NOT NULL,

  -- Flexible limits. Expected keys: max_users, max_messages, max_storage_mb.
  -- Background jobs and middleware read from this JSONB — no column migration
  -- needed when new limit types are introduced.
  limits_json   JSONB         NOT NULL DEFAULT '{}',

  -- Feature flags. Expected keys: api_access, custom_reports, white_label, etc.
  features_json JSONB         NOT NULL DEFAULT '{}',

  price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN tenant_plans.limits_json   IS 'Flexible limit definitions. Keys: max_users, max_messages, max_storage_mb, etc.';
COMMENT ON COLUMN tenant_plans.features_json IS 'Feature flags for this plan. Keys: api_access, custom_reports, white_label, etc.';


-- ── 2. tenant_subscriptions ───────────────────────────────────────────────────
CREATE TABLE tenant_subscriptions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL,
  plan_id              UUID        NOT NULL,

  -- Lifecycle states:
  --   TRIAL     — free evaluation period; limits apply
  --   ACTIVE    — paid and current
  --   PAST_DUE  — payment missed; grace window may apply
  --   GRACE     — explicitly in grace period after PAST_DUE
  --   SUSPENDED — manually blocked by platform admin
  --   CANCELED  — terminated; no access
  status               VARCHAR(20) NOT NULL,

  current_period_start TIMESTAMP   NOT NULL,
  current_period_end   TIMESTAMP   NOT NULL,

  -- Optional grace window end. NULL = no grace period configured.
  -- Used by service layer to compute GRACE vs EXPIRED.
  grace_until          TIMESTAMP   NULL,

  created_at           TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_ts_org  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_ts_plan FOREIGN KEY (plan_id)          REFERENCES tenant_plans(id),
  CONSTRAINT chk_ts_status CHECK (
    status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'GRACE', 'SUSPENDED', 'CANCELED')
  )
);

CREATE INDEX idx_ts_org_status
  ON tenant_subscriptions (organization_id, status);

COMMENT ON COLUMN tenant_subscriptions.grace_until IS 'End of grace window after PAST_DUE. NULL if no grace period. Service layer computes GRACE vs EXPIRED from this.';
COMMENT ON COLUMN tenant_subscriptions.status      IS 'DB-stored lifecycle state. Middleware reads computed status from service layer, not this column directly.';


-- ── 3. usage_events ───────────────────────────────────────────────────────────
-- Append-only. Never UPDATE or DELETE in application code.
-- Background aggregator reads this and writes to usage_summary_period.
CREATE TABLE usage_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL,
  metric          VARCHAR(50) NOT NULL,   -- MESSAGES_SENT, USERS_ACTIVE, STORAGE_MB, etc.
  amount          INT         NOT NULL,
  occurred_at     TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_ue_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

CREATE INDEX idx_ue_org_occurred
  ON usage_events (organization_id, occurred_at DESC);

CREATE INDEX idx_ue_org_metric_period
  ON usage_events (organization_id, metric, occurred_at);


-- ── 4. usage_summary_period ───────────────────────────────────────────────────
-- Pre-aggregated totals per (org, metric, period_start).
-- Written by a background aggregation worker via:
--   INSERT ... ON CONFLICT (organization_id, metric, period_start)
--   DO UPDATE SET total_amount = EXCLUDED.total_amount, updated_at = NOW()
-- Service layer reads this first; falls back to raw usage_events if absent.
CREATE TABLE usage_summary_period (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL,
  metric          VARCHAR(50) NOT NULL,
  period_start    TIMESTAMP   NOT NULL,
  total_amount    BIGINT      NOT NULL DEFAULT 0,
  updated_at      TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_usp_org          FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT uq_usp_org_metric_period
    UNIQUE (organization_id, metric, period_start)  -- supports ON CONFLICT upsert
);

CREATE INDEX idx_usp_org_metric_period
  ON usage_summary_period (organization_id, metric, period_start);

COMMENT ON TABLE usage_summary_period IS 'Pre-aggregated period usage totals. Upserted by background worker. Service layer reads this first before falling back to usage_events.';
COMMENT ON CONSTRAINT uq_usp_org_metric_period ON usage_summary_period IS 'Unique key enables background aggregator to use INSERT ... ON CONFLICT DO UPDATE.';


-- ── 5. billing_ledger ─────────────────────────────────────────────────────────
-- Append-only payment / charge records. One row per billing attempt.
-- payment_status transitions: PENDING → SUCCESS | FAILED → (REFUNDED)
CREATE TABLE billing_ledger (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID          NOT NULL,
  amount             NUMERIC(10,2) NOT NULL,
  currency           VARCHAR(10)   NOT NULL DEFAULT 'INR',
  payment_status     VARCHAR(20)   NOT NULL,
  provider_reference TEXT,          -- Gateway txn ID / reference; NULL until confirmed
  created_at         TIMESTAMP     NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_bl_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT chk_bl_payment_status CHECK (
    payment_status IN ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED')
  )
);

CREATE INDEX idx_bl_org_created
  ON billing_ledger (organization_id, created_at DESC);

COMMENT ON TABLE billing_ledger IS 'Append-only payment charge log. Never UPDATE or DELETE rows. One row per billing attempt.';
COMMENT ON COLUMN billing_ledger.provider_reference IS 'Gateway transaction ID or reference. NULL until payment is confirmed by gateway callback.';

COMMIT;
