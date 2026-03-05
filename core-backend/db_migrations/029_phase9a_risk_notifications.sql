-- @no-transaction
-- ============================================================
-- MIGRATION 029: Phase-9.A Risk Notifications
-- ============================================================
--
-- Adds awareness-only email notification infrastructure layered
-- on top of the Phase-8.7 risk_cases triage system.
--
-- AWARENESS ONLY — this schema does NOT support:
--   • Session revocation or forced logout
--   • Automatic case closure
--   • Student / finance / personal data exposure
--
-- Tables created:
--   org_security_contacts  — email recipients per organization
--   org_risk_policy        — per-org notification policy
--   risk_notifications     — immutable audit trail of every send attempt
--
-- Existing table altered:
--   risk_cases — adds user identity snapshot columns and
--                notification_evaluated_at for incremental evaluation
--
-- Phase 1 — transactional DDL (BEGIN / COMMIT)
-- Phase 2 — CONCURRENTLY indexes (outside transaction)
-- ============================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Transactional schema changes
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── risk_cases extensions ──────────────────────────────────────────────────────
-- Identity snapshot populated by riskNotification.worker on first evaluation.
-- Cached to avoid repeated JOINs on every email render cycle.
-- All three columns are NULL-safe and additive — no impact on Phase-8.7 logic.

ALTER TABLE risk_cases
  ADD COLUMN IF NOT EXISTS user_display_name         TEXT          NULL,
  ADD COLUMN IF NOT EXISTS user_role_label           TEXT          NULL,
  ADD COLUMN IF NOT EXISTS notification_evaluated_at TIMESTAMPTZ   NULL;

COMMENT ON COLUMN risk_cases.user_display_name IS
  'Snapshot of users.full_name at time of last notification worker cycle. '
  'Cached to avoid a runtime JOIN during email rendering. '
  'Set by riskNotification.worker via _ensureUserSnapshot(); never set by riskCase.worker.';

COMMENT ON COLUMN risk_cases.user_role_label IS
  'Snapshot of roles.name at time of last notification worker cycle. '
  'Populated alongside user_display_name by riskNotification.worker.';

COMMENT ON COLUMN risk_cases.notification_evaluated_at IS
  'Timestamp of the last riskNotification.worker evaluation for this case. '
  'NULL = never evaluated (case is new). '
  'Worker re-evaluates when updated_at > notification_evaluated_at OR when NULL. '
  'Stamped at the end of each per-case processing step, even when skipped.';


-- ── org_security_contacts ─────────────────────────────────────────────────────
-- Zero or more email recipients per organization.
-- All active contacts receive the same notification email in the same worker cycle.
-- Managed via admin API; never exposed to end-user self-service.

CREATE TABLE IF NOT EXISTS org_security_contacts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,
  contact_name     TEXT        NOT NULL,
  contact_email    TEXT        NOT NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE org_security_contacts IS
  'Email recipients for Phase-9.A risk notification emails. '
  'One org may have multiple contacts; all active contacts receive the same alert. '
  'Managed via admin API. contact_email format is validated at the application layer.';

COMMENT ON COLUMN org_security_contacts.is_active IS
  'Set to false to stop notifications to a contact without deleting the record. '
  'Inactive contacts are excluded from all worker queries.';


-- ── org_risk_policy ───────────────────────────────────────────────────────────
-- One row per organization (PK = organization_id).
-- Absent row = notifications disabled for that org (worker skips it).
-- Defaults are deliberately conservative (HIGH threshold, 60-minute cooldown).

CREATE TABLE IF NOT EXISTS org_risk_policy (
  organization_id               UUID        PRIMARY KEY,

  -- Minimum peak_risk_level that triggers a notification.
  -- ELEVATED → all risk cases; HIGH (default) → HIGH + CRITICAL only;
  -- CRITICAL → most severe cases only.
  minimum_risk_level            VARCHAR(10) NOT NULL DEFAULT 'HIGH'
                                  CHECK (minimum_risk_level IN ('ELEVATED', 'HIGH', 'CRITICAL')),

  -- Minimum gap between consecutive notifications for the same org.
  -- Prevents alert fatigue when multiple users spike simultaneously.
  notification_cooldown_minutes INTEGER     NOT NULL DEFAULT 60
                                  CHECK (notification_cooldown_minutes > 0),

  -- Whether to send an email when a new OPEN case is first created.
  notify_on_new_case            BOOLEAN     NOT NULL DEFAULT true,

  -- Whether to send an email when an existing OPEN case's peak_risk_score
  -- increases beyond the score recorded at the last sent notification.
  -- Subject to cooldown.
  notify_on_risk_increase       BOOLEAN     NOT NULL DEFAULT true,

  -- Master switch. Set to false to disable all notifications for this org
  -- without deleting the policy row.
  is_enabled                    BOOLEAN     NOT NULL DEFAULT true,

  created_at                    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE org_risk_policy IS
  'Per-organization notification policy for Phase-9.A awareness emails. '
  'One row per org. Absent row = notifications disabled for that org. '
  'Defaults: HIGH threshold, 60-minute cooldown, both notification triggers enabled.';

COMMENT ON COLUMN org_risk_policy.notification_cooldown_minutes IS
  'Minimum gap in minutes between consecutive SENT notifications for the same org. '
  'Cooldown is per-organization, not per-case, to prevent alert storms when '
  'multiple users spike simultaneously. Default: 60 minutes.';

COMMENT ON COLUMN org_risk_policy.notify_on_risk_increase IS
  'Send a follow-up email when an existing OPEN case''s peak_risk_score '
  'has increased since the last SENT notification. Subject to cooldown. '
  'Prevents silent escalations after the initial notification.';


-- ── risk_notifications ────────────────────────────────────────────────────────
-- Immutable insert-only audit trail.
-- One row per (case, contact) per send attempt.
-- Records SENT, FAILED, and SKIPPED outcomes.

CREATE TABLE IF NOT EXISTS risk_notifications (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL,
  case_id              UUID        NOT NULL,

  -- Currently only EMAIL is supported.
  notification_type    VARCHAR(20) NOT NULL DEFAULT 'EMAIL'
                         CHECK (notification_type IN ('EMAIL')),

  -- SENT:    email was accepted by the SMTP server.
  -- FAILED:  send attempt was made but rejected (SMTP error, transport unavailable).
  -- SKIPPED: worker decided not to send (policy, cooldown, no contacts, etc.).
  status               VARCHAR(20) NOT NULL
                         CHECK (status IN ('SENT', 'FAILED', 'SKIPPED')),

  -- Populated for EMAIL notifications.
  recipient_email      TEXT        NULL,
  subject              TEXT        NULL,

  -- peak_risk_score from the case at time of send.
  -- Used on the next worker cycle to detect score increases for
  -- notify_on_risk_increase logic.
  risk_score_at_send   INTEGER     NULL,

  -- Populated when status = 'SKIPPED'.
  skip_reason          TEXT        NULL,

  -- Populated when status = 'FAILED' (SMTP error message or reason code).
  fail_reason          TEXT        NULL,

  -- Always UTC.
  created_at           TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE risk_notifications IS
  'Immutable audit log of Phase-9.A risk notification attempts. '
  'Written for every SENT, FAILED, and SKIPPED outcome per case per contact. '
  'Never updated — insert-only. Retention target: 90 days.';

COMMENT ON COLUMN risk_notifications.risk_score_at_send IS
  'peak_risk_score from risk_cases at the moment this notification was generated. '
  'Compared against peak_risk_score on the next worker cycle to decide whether '
  'the risk has increased enough to warrant a follow-up notification.';

COMMENT ON COLUMN risk_notifications.skip_reason IS
  'Human-readable code describing why the notification was skipped. '
  'Examples: POLICY_DISABLED, NO_CONTACTS, COOLDOWN_ACTIVE, LEVEL_BELOW_MINIMUM, '
  'NOTIFY_ON_NEW_CASE_DISABLED, NO_RISK_INCREASE.';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — CONCURRENTLY indexes
--
-- All must run OUTSIDE a transaction block (PostgreSQL restriction for CONCURRENTLY).
-- IF NOT EXISTS guards make re-runs safe.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── org_security_contacts ─────────────────────────────────────────────────────

-- Covers the worker's active-contacts query:
--   SELECT contact_name, contact_email FROM org_security_contacts
--   WHERE organization_id = $1 AND is_active = true
-- Partial: inactive contacts are never fetched — excluding them keeps
-- the index compact as the table grows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_osc_org_active
  ON org_security_contacts (organization_id)
  WHERE is_active = true;


-- ── risk_notifications ────────────────────────────────────────────────────────

-- Covers the per-case "has a notification already been sent?" check:
--   SELECT risk_score_at_send FROM risk_notifications
--   WHERE case_id = $1 AND status = 'SENT' AND notification_type = 'EMAIL'
--   ORDER BY created_at DESC LIMIT 1
-- Partial: only SENT rows are used for deduplication and score comparison.
-- FAILED and SKIPPED rows are excluded to keep the index small.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rn_case_sent
  ON risk_notifications (case_id, created_at DESC)
  WHERE status = 'SENT' AND notification_type = 'EMAIL';

-- Covers the per-org cooldown check:
--   SELECT 1 FROM risk_notifications
--   WHERE organization_id = $1 AND status = 'SENT'
--     AND created_at > NOW() - ($N * INTERVAL '1 minute')
--   LIMIT 1
-- Partial: only SENT rows trigger cooldown. FAILED/SKIPPED do not count.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rn_org_sent_time
  ON risk_notifications (organization_id, created_at DESC)
  WHERE status = 'SENT';
