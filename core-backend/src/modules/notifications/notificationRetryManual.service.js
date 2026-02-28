'use strict';

const pool                    = require('../../config/db');
const { sendWhatsAppMessage } = require('../../utils/whatsapp.service');

const MAX_ATTEMPTS = 3;

async function manualRetry({ organizationId, logId }) {
  // ── Fetch and validate log entry ─────────────────────────
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_id, contact_number,
            message, reminder_type, status, attempts
     FROM   notification_logs
     WHERE  id              = $1
       AND  organization_id = $2`,
    [logId, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('Notification log not found');
    err.statusCode = 404;
    throw err;
  }

  const log = rows[0];

  if (log.status !== 'FAILED') {
    const err = new Error(`Cannot retry a notification with status "${log.status}"`);
    err.statusCode = 422;
    throw err;
  }

  if (log.attempts >= MAX_ATTEMPTS) {
    const err = new Error(`Maximum retry attempts (${MAX_ATTEMPTS}) already reached`);
    err.statusCode = 422;
    throw err;
  }

  if (!log.contact_number || !log.message) {
    const err = new Error('Log entry is missing contact_number or message — cannot retry');
    err.statusCode = 422;
    throw err;
  }

  const newAttempts = log.attempts + 1;

  // ── Attempt send ─────────────────────────────────────────
  try {
    const result = await sendWhatsAppMessage(log.contact_number, log.message);

    await pool.query(
      `UPDATE notification_logs
       SET status        = 'SUCCESS',
           message_id    = $1,
           sent_at       = NOW(),
           attempts      = $2,
           error_message = NULL
       WHERE id = $3`,
      [result.messageId, newAttempts, logId]
    );

    return {
      retried:      true,
      success:      true,
      logId,
      attempts:     newAttempts,
      messageId:    result.messageId,
      contactNumber: log.contact_number,
    };
  } catch (sendErr) {
    await pool.query(
      `UPDATE notification_logs
       SET attempts      = $1,
           error_message = $2
       WHERE id = $3`,
      [newAttempts, sendErr.message, logId]
    );

    const err = new Error(sendErr.message);
    err.statusCode = 502;
    err.retried    = true;
    err.attempts   = newAttempts;
    throw err;
  }
}

module.exports = { manualRetry };
