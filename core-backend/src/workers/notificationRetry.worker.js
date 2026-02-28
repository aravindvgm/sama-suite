'use strict';

/**
 * notificationRetry.worker.js
 *
 * Retries FAILED notification_log entries that have not yet exhausted
 * their attempt budget (attempts < 3).
 *
 * On retry success → updates row: status=SUCCESS, message_id, sent_at, attempts++
 * On retry failure → updates row: attempts++, error_message (status stays FAILED)
 *
 * Designed to run on a schedule (e.g. every 30 minutes) or be imported
 * programmatically. Never crashes the process.
 *
 * Suggested cron addition in jobScheduler.worker.js:
 *   every 30 min:  *\/30 * * * *
 */

require('dotenv').config();

const pool                    = require('../config/db');
const { sendWhatsAppMessage } = require('../utils/whatsapp.service');

const MAX_ATTEMPTS   = 3;
const THROTTLE_MS    = 500;
const RETRY_WINDOW_H = 24; // only retry failures from the last 24 hours

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// FETCH RETRYABLE FAILURES
// ============================================================

async function fetchRetryable() {
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_id, fee_id,
            contact_number, channel, message, reminder_type, attempts
     FROM   notification_logs
     WHERE  status      = 'FAILED'
       AND  attempts    < $1
       AND  created_at >= NOW() - INTERVAL '${RETRY_WINDOW_H} hours'
     ORDER  BY created_at ASC`,
    [MAX_ATTEMPTS]
  );
  return rows;
}

// ============================================================
// UPDATE HELPERS
// ============================================================

async function markSuccess(id, messageId, attempts) {
  try {
    await pool.query(
      `UPDATE notification_logs
       SET status        = 'SUCCESS',
           message_id    = $1,
           sent_at       = NOW(),
           attempts      = $2,
           error_message = NULL
       WHERE id = $3`,
      [messageId, attempts, id]
    );
  } catch (err) {
    console.error(`[RetryWorker] markSuccess DB error (id=${id}):`, err.message);
  }
}

async function markFailed(id, errorMessage, attempts) {
  try {
    await pool.query(
      `UPDATE notification_logs
       SET attempts      = $1,
           error_message = $2
       WHERE id = $3`,
      [attempts, errorMessage, id]
    );
  } catch (err) {
    console.error(`[RetryWorker] markFailed DB error (id=${id}):`, err.message);
  }
}

// ============================================================
// CORE RETRY LOOP
// ============================================================

async function runRetryLoop() {
  let retryable;
  try {
    retryable = await fetchRetryable();
  } catch (err) {
    console.error('[RetryWorker] Failed to fetch retryable entries:', err.message);
    return { fetched: 0, retried: 0, recovered: 0, exhausted: 0 };
  }

  const stats = { fetched: retryable.length, retried: 0, recovered: 0, exhausted: 0 };

  if (retryable.length === 0) {
    console.log('[RetryWorker] No retryable failures found.');
    return stats;
  }

  console.log(`[RetryWorker] Retrying ${retryable.length} failed notification(s)…`);

  for (const entry of retryable) {
    const newAttempts = entry.attempts + 1;

    if (!entry.contact_number || !entry.message) {
      console.warn(`[RetryWorker] Skipping id=${entry.id} — missing contact or message`);
      continue;
    }

    try {
      const result = await sendWhatsAppMessage(entry.contact_number, entry.message);

      await markSuccess(entry.id, result.messageId, newAttempts);

      stats.retried++;
      stats.recovered++;
      console.log(
        `[RetryWorker] ✓ Recovered id=${entry.id} → ${entry.contact_number} (attempt ${newAttempts}/${MAX_ATTEMPTS} msgId=${result.messageId})`
      );
    } catch (err) {
      await markFailed(entry.id, err.message, newAttempts);

      stats.retried++;

      if (newAttempts >= MAX_ATTEMPTS) {
        stats.exhausted++;
        console.error(
          `[RetryWorker] ✗ Exhausted id=${entry.id} → ${entry.contact_number} after ${newAttempts} attempts: ${err.message}`
        );
      } else {
        console.warn(
          `[RetryWorker] ✗ Still failing id=${entry.id} → ${entry.contact_number} (attempt ${newAttempts}/${MAX_ATTEMPTS}): ${err.message}`
        );
      }
    }

    await sleep(THROTTLE_MS);
  }

  return stats;
}

// ============================================================
// WORKER ENTRY POINT (fire-and-forget safe)
// ============================================================

async function runNotificationRetry() {
  const startedAt = new Date();
  console.log(`[RetryWorker] Started at ${startedAt.toISOString()}`);

  const stats = await runRetryLoop();

  const completedAt = new Date();
  console.log(
    `[RetryWorker] Done — Fetched: ${stats.fetched}, Retried: ${stats.retried}, ` +
    `Recovered: ${stats.recovered}, Exhausted: ${stats.exhausted} ` +
    `(${completedAt - startedAt}ms)`
  );

  return stats;
}

// ============================================================
// STANDALONE EXECUTION
// ============================================================

if (require.main === module) {
  runNotificationRetry()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[RetryWorker] Unhandled rejection:', err);
      process.exit(1);
    })
    .finally(async () => {
      await pool.end().catch((e) =>
        console.error('[RetryWorker] Pool close error:', e.message)
      );
    });
}

module.exports = { runNotificationRetry };
