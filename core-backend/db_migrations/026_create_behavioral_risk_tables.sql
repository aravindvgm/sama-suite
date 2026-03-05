-- @no-transaction
-- ============================================================
-- MIGRATION 026: Behavioral Risk & Data Access Observability
-- ============================================================
--
-- Creates three tables for Phase-8.5 behavioral risk scoring:
--
--   behavioral_risk_events
--     Append-only log of detected anomaly events per user.
--     One row per triggered signal instance (deduped by 15-minute
--     buckets via NOT EXISTS guard in the service layer).
--     Scores decay after 24 hours (expires_at).
--
--   user_risk_state
--     Current risk posture per (organization_id, user_id).
--     Upserted by behavioralRisk.worker every 15 minutes.
--     risk_level is derived deterministically from risk_score:
--       NORMAL:   0–29   ELEVATED: 30–59   HIGH: 60–89   CRITICAL: 90+
--
--   school_risk_config
--     Per-organisation threshold overrides for each signal.
--     Missing rows cause the service to fall back to hard-coded defaults.
--     off_hours_start / off_hours_end are stored in local time matching
--     CRON_TIMEZONE (default: Asia/Kolkata).
--
-- Phase 1 — new tables (transactional)
-- Phase 2 — CONCURRENTLY index on existing audit_logs table
-- ============================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Transactional schema changes
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── behavioral_risk_events ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS behavioral_risk_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL,
  user_id         UUID         NOT NULL,
  signal_type     VARCHAR(50)  NOT NULL
                    CHECK (signal_type IN (
                      'ENUMERATION',
                      'EXPORT_SPIKE',
                      'SENSITIVE_CONCENTRATION',
                      'OFF_HOURS',
                      'ROLE_DEVIATION'
                    )),
  severity        VARCHAR(10)  NOT NULL
                    CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  score_delta     INTEGER      NOT NULL CHECK (score_delta > 0),
  context         JSONB        NULL,
  detected_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMP    NOT NULL
);

-- Covering index for dedup check + score aggregation
CREATE INDEX IF NOT EXISTS idx_bre_lookup
  ON behavioral_risk_events (organization_id, user_id, signal_type, detected_at DESC);

-- Index to support scheduled cleanup / expiry queries
CREATE INDEX IF NOT EXISTS idx_bre_expires
  ON behavioral_risk_events (expires_at);

-- ── user_risk_state ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_risk_state (
  organization_id UUID         NOT NULL,
  user_id         UUID         NOT NULL,
  risk_score      INTEGER      NOT NULL DEFAULT 0,
  risk_level      VARCHAR(10)  NOT NULL DEFAULT 'NORMAL'
                    CHECK (risk_level IN ('NORMAL', 'ELEVATED', 'HIGH', 'CRITICAL')),
  last_updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  signals_summary JSONB        NULL,
  PRIMARY KEY (organization_id, user_id)
);

-- Used by admin security dashboard queries: list HIGH/CRITICAL users per org
CREATE INDEX IF NOT EXISTS idx_urs_risk_level
  ON user_risk_state (organization_id, risk_level, last_updated_at DESC);

-- ── school_risk_config ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS school_risk_config (
  organization_id         UUID         PRIMARY KEY,
  -- Signal 1: ENUMERATION — student list/search request count in 10 min
  enumeration_threshold   INTEGER      NOT NULL DEFAULT 20
                            CHECK (enumeration_threshold > 0),
  -- Signal 2: EXPORT_SPIKE — export/download count in 30 min
  export_threshold        INTEGER      NOT NULL DEFAULT 5
                            CHECK (export_threshold > 0),
  -- Signal 3: SENSITIVE_CONCENTRATION — % of requests to sensitive entities in 60 min
  sensitive_pct_threshold NUMERIC(5,2) NOT NULL DEFAULT 60.00
                            CHECK (sensitive_pct_threshold BETWEEN 1 AND 100),
  -- Signal 4: OFF_HOURS — local time window (matches CRON_TIMEZONE)
  off_hours_start         TIME         NOT NULL DEFAULT '22:00',
  off_hours_end           TIME         NOT NULL DEFAULT '06:00',
  updated_at              TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Column comments ───────────────────────────────────────────────────────────

COMMENT ON TABLE behavioral_risk_events IS
  'Append-only log of behavioral anomaly events per user. '
  'Each row represents one signal trigger. Decay window = 24 hours (expires_at). '
  'Service layer deduplicates within 15-minute windows per (org, user, signal_type).';

COMMENT ON TABLE user_risk_state IS
  'Current risk posture snapshot per user+org. '
  'Upserted by behavioralRisk.worker every 15 minutes. '
  'risk_score = SUM(score_delta) from non-expired behavioral_risk_events. '
  'risk_level: NORMAL 0-29 | ELEVATED 30-59 | HIGH 60-89 | CRITICAL 90+.';

COMMENT ON TABLE school_risk_config IS
  'Per-organisation threshold overrides for behavioral risk signals. '
  'Rows are optional — the service falls back to coded defaults when absent.';

COMMENT ON COLUMN school_risk_config.off_hours_start IS
  'Local time (CRON_TIMEZONE) at which off-hours window begins. Default: 22:00. '
  'If off_hours_start > off_hours_end the window spans midnight (typical school scenario).';

COMMENT ON COLUMN school_risk_config.off_hours_end IS
  'Local time at which off-hours window ends. Default: 06:00.';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — CONCURRENTLY index on existing audit_logs table
--
-- Optimises the behavioralRisk signal detector queries that filter on
-- (actor_type = 'USER', actor_user_id IS NOT NULL) and order/window by created_at.
-- CONCURRENTLY never takes a full table lock — safe on any size table.
-- Must run outside a transaction block (PostgreSQL restriction).
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_actor_user
  ON audit_logs (actor_user_id, organization_id, created_at DESC)
  WHERE actor_type = 'USER' AND actor_user_id IS NOT NULL;
