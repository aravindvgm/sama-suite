-- ============================================================
-- MIGRATION: Create assistant_sessions table
--
-- Stores the last assistant response context per user so that
-- vague follow-up questions ("send reminders to them") can be
-- resolved against the previous intent without re-querying.
-- One row per (organization_id, user_id) — always up-to-date.
-- ============================================================

CREATE TABLE assistant_sessions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL,
  user_id         UUID        NOT NULL,
  last_intent     VARCHAR(50),
  context_json    JSONB,
  updated_at      TIMESTAMP   NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_asst_session_org  FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT uq_asst_session_user UNIQUE (organization_id, user_id)
);

COMMENT ON TABLE  assistant_sessions              IS 'Per-user context window for the Principal AI Assistant.';
COMMENT ON COLUMN assistant_sessions.last_intent  IS 'Intent from the most recent assistant response.';
COMMENT ON COLUMN assistant_sessions.context_json IS 'Summary of the last response data used for follow-up resolution.';
