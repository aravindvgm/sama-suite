/**
 * MIGRATION: Create notification_logs table
 *
 * Records every WhatsApp/SMS dispatch attempt made by the
 * notificationDispatcher worker. Append-only audit log.
 */

CREATE TABLE IF NOT EXISTS notification_logs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,
  student_id       UUID,
  fee_id           UUID,
  contact_number   VARCHAR(20),
  channel          VARCHAR(20)  NOT NULL DEFAULT 'WHATSAPP',
  message          TEXT,
  reminder_type    VARCHAR(20),
  status           VARCHAR(10)  NOT NULL,
  message_id       VARCHAR(255),
  attempts         INTEGER      NOT NULL DEFAULT 1,
  error_message    TEXT,
  sent_at          TIMESTAMP,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notif_log_org        ON notification_logs(organization_id);
CREATE INDEX idx_notif_log_student    ON notification_logs(student_id);
CREATE INDEX idx_notif_log_status     ON notification_logs(status);
CREATE INDEX idx_notif_log_created_at ON notification_logs(created_at DESC);

COMMENT ON TABLE notification_logs IS 'Append-only log of every WhatsApp/SMS dispatch attempt. Never updated after insert.';
COMMENT ON COLUMN notification_logs.status       IS 'SUCCESS or FAILED.';
COMMENT ON COLUMN notification_logs.message_id   IS 'Gateway-assigned message ID on successful send.';
COMMENT ON COLUMN notification_logs.attempts     IS 'Total send attempts including retries.';
COMMENT ON COLUMN notification_logs.error_message IS 'Final error from gateway on FAILED status.';
COMMENT ON COLUMN notification_logs.sent_at      IS 'Timestamp of successful send. NULL on FAILED.';
