'use strict';

const pool = require('../config/db');

// ============================================================
// BASE INSERT
// ============================================================

async function createNotificationLog({
  organizationId,
  studentId       = null,
  feeId           = null,
  contactNumber   = null,
  channel         = 'WHATSAPP',
  message         = null,
  reminderType    = null,
  status,
  messageId       = null,
  attempts        = 1,
  errorMessage    = null,
  sentAt          = null,
}) {
  try {
    await pool.query(
      `INSERT INTO notification_logs
         (organization_id, student_id, fee_id, contact_number, channel,
          message, reminder_type, status, message_id, attempts,
          error_message, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        organizationId,
        studentId,
        feeId,
        contactNumber,
        channel,
        message,
        reminderType,
        status,
        messageId,
        attempts,
        errorMessage,
        sentAt,
      ]
    );
  } catch (err) {
    // Logging must never crash the dispatcher
    console.error('[NotificationLog] Failed to write log entry:', err.message);
  }
}

// ============================================================
// LOG SUCCESS
// ============================================================

async function logSuccess({
  organizationId,
  studentId,
  feeId,
  contactNumber,
  channel,
  message,
  reminderType,
  messageId,
  attempts,
}) {
  return createNotificationLog({
    organizationId,
    studentId,
    feeId,
    contactNumber,
    channel,
    message,
    reminderType,
    status:    'SUCCESS',
    messageId,
    attempts,
    sentAt:    new Date(),
  });
}

// ============================================================
// LOG FAILURE
// ============================================================

async function logFailure({
  organizationId,
  studentId,
  feeId,
  contactNumber,
  channel,
  message,
  reminderType,
  attempts,
  errorMessage,
}) {
  return createNotificationLog({
    organizationId,
    studentId,
    feeId,
    contactNumber,
    channel,
    message,
    reminderType,
    status:       'FAILED',
    attempts,
    errorMessage,
    sentAt:       null,
  });
}

module.exports = { createNotificationLog, logSuccess, logFailure };
