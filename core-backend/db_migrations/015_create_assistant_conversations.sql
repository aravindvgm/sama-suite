-- ============================================================
-- MIGRATION: Create assistant_conversations table
--
-- Stores every question + answer pair from the Principal AI
-- Assistant for per-organisation conversation history.
-- ============================================================

CREATE TABLE assistant_conversations (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL,
  user_id         UUID,                           -- nullable; set when caller is authenticated
  question        TEXT         NOT NULL,
  answer          TEXT         NOT NULL,
  intent          VARCHAR(50),                    -- detected intent label
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_asst_conv_org  FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Primary access pattern: latest N conversations per organisation
CREATE INDEX idx_asst_conv_org_created
  ON assistant_conversations(organization_id, created_at DESC);

-- Secondary: per-user history within an org
CREATE INDEX idx_asst_conv_user_created
  ON assistant_conversations(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

COMMENT ON TABLE  assistant_conversations                IS 'Audit trail of Principal AI Assistant Q&A sessions.';
COMMENT ON COLUMN assistant_conversations.intent         IS 'Intent label resolved by the assistant (OVERDUE_FEES, LOW_ATTENDANCE, etc.).';
COMMENT ON COLUMN assistant_conversations.user_id        IS 'Authenticated user who asked the question. NULL for system-generated queries.';
