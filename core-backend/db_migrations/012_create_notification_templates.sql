-- =============================================================
-- 012_create_notification_templates.sql
-- Organization-scoped message templates for the notification system.
-- =============================================================

CREATE TABLE IF NOT EXISTS notification_templates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(150) NOT NULL,
  type             VARCHAR(50)  NOT NULL,
  message_template TEXT         NOT NULL,
  send_to          VARCHAR(50)  NOT NULL DEFAULT 'WHATSAPP',
  created_by       UUID         REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at       TIMESTAMP    NULL,

  CONSTRAINT uq_org_template_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_notif_templates_org    ON notification_templates (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notif_templates_type   ON notification_templates (organization_id, type) WHERE deleted_at IS NULL;
