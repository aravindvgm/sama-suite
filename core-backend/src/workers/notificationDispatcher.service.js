'use strict';

const { sendWhatsAppMessage } = require('../utils/whatsapp.service');
const { logSuccess, logFailure } = require('./notificationLogs.service');
const pool                        = require('../config/db');

const MAX_RETRIES   = 3;
const RETRY_DELAY   = 1000; // ms between retry attempts
const SEND_INTERVAL = 500;  // ms between sequential sends

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if a SUCCESS reminder was already sent today for the
 * same org / student / fee / reminderType combination.
 * Never throws — returns false on DB error so the dispatcher is never blocked.
 */
async function hasAlreadySentToday({ organizationId, studentId, feeId, reminderType }) {
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM   notification_logs
         WHERE  organization_id = $1
           AND  student_id      = $2
           AND  fee_id          = $3
           AND  reminder_type   = $4
           AND  status          = 'SUCCESS'
           AND  DATE(sent_at)   = CURRENT_DATE
       ) AS already_sent`,
      [organizationId, studentId, feeId, reminderType]
    );
    return rows[0].already_sent === true;
  } catch (err) {
    console.error('[Dispatcher] Dedup check failed (allowing send):', err.message);
    return false;
  }
}

/**
 * Attempt to send a single message with up to MAX_RETRIES retries.
 * Never throws — returns a result object.
 */
async function sendWithRetry({ contactNumber, message, attempt = 1 }) {
  try {
    const result = await sendWhatsAppMessage(contactNumber, message);
    return {
      success:   true,
      messageId: result.messageId,
      attempts:  attempt,
    };
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      console.warn(
        `[Dispatcher] Send failed (attempt ${attempt}/${MAX_RETRIES}) → ${contactNumber}: ${err.message}. Retrying in ${RETRY_DELAY}ms…`
      );
      await sleep(RETRY_DELAY);
      return sendWithRetry({ contactNumber, message, attempt: attempt + 1 });
    }

    console.error(
      `[Dispatcher] Send permanently failed after ${MAX_RETRIES} attempts → ${contactNumber}: ${err.message}`
    );
    return {
      success:  false,
      error:    err.message,
      attempts: attempt,
    };
  }
}

// ============================================================
// DISPATCHER
// ============================================================

/**
 * dispatchReminders(reminders)
 *
 * Sends all fee-reminder notifications sequentially with a fixed
 * inter-message delay to avoid gateway rate limits.
 *
 * @param {Array<{
 *   organizationId: string,
 *   studentId:      string,
 *   feeId:          string,
 *   contactNumber:  string,
 *   reminderType:   'UPCOMING'|'OVERDUE',
 *   messagePayload: { message: string, studentName: string, feeName: string, ... }
 * }>} reminders
 *
 * @returns {Promise<{
 *   total:    number,
 *   sent:     number,
 *   failed:   number,
 *   skipped:  number,
 *   results:  Array<object>
 * }>}
 */
async function dispatchReminders(reminders) {
  const stats = { total: reminders.length, sent: 0, failed: 0, skipped: 0, results: [] };

  for (const reminder of reminders) {
    const { organizationId, studentId, feeId, contactNumber, reminderType, messagePayload } = reminder;

    // Guard against malformed payloads
    if (!contactNumber || !messagePayload?.message) {
      console.warn(
        `[Dispatcher] Skipping reminder — missing contact or message (studentId=${studentId} feeId=${feeId})`
      );
      stats.skipped++;
      stats.results.push({ studentId, feeId, reminderType, skipped: true, reason: 'missing_contact_or_message' });
      continue;
    }

    // Duplicate-send guard — skip if already sent successfully today
    const alreadySent = await hasAlreadySentToday({ organizationId, studentId, feeId, reminderType });
    if (alreadySent) {
      console.warn(
        `[Dispatcher] Reminder skipped — already sent today (studentId=${studentId} feeId=${feeId} type=${reminderType})`
      );
      stats.skipped++;
      stats.results.push({ studentId, feeId, reminderType, skipped: true, reason: 'already_sent_today' });
      continue;
    }

    let result;
    try {
      result = await sendWithRetry({
        contactNumber,
        message: messagePayload.message,
      });
    } catch (unexpectedErr) {
      // sendWithRetry should never throw, but guard regardless
      console.error(`[Dispatcher] Unexpected error for studentId=${studentId}:`, unexpectedErr.message);
      result = { success: false, error: unexpectedErr.message, attempts: MAX_RETRIES };
    }

    if (result.success) {
      stats.sent++;
      console.log(
        `[Dispatcher] ✓ Sent ${reminderType} reminder → ${contactNumber} (student=${studentId} fee=${feeId} msgId=${result.messageId})`
      );
      // Fire-and-forget — logging must never crash the dispatcher
      logSuccess({
        organizationId,
        studentId,
        feeId,
        contactNumber,
        channel:      'WHATSAPP',
        message:      messagePayload.message,
        reminderType,
        messageId:    result.messageId,
        attempts:     result.attempts,
      }).catch((e) => console.error('[Dispatcher] logSuccess error:', e.message));
    } else {
      stats.failed++;
      // Fire-and-forget — logging must never crash the dispatcher
      logFailure({
        organizationId,
        studentId,
        feeId,
        contactNumber,
        channel:      'WHATSAPP',
        message:      messagePayload.message,
        reminderType,
        attempts:     result.attempts,
        errorMessage: result.error,
      }).catch((e) => console.error('[Dispatcher] logFailure error:', e.message));
    }

    stats.results.push({
      organizationId,
      studentId,
      feeId,
      contactNumber,
      reminderType,
      ...result,
    });

    // Throttle between sends
    await sleep(SEND_INTERVAL);
  }

  return stats;
}

module.exports = { dispatchReminders };
