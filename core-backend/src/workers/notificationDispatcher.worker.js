'use strict';

/**
 * notificationDispatcher.worker.js
 *
 * Runs the full fee-reminder → dispatch pipeline.
 * Safe to execute as a standalone cron script or programmatic import.
 *
 * Usage:
 *   node src/workers/notificationDispatcher.worker.js      (direct)
 *   const { runNotificationDispatcher } = require(...)    (programmatic)
 *
 * Suggested cron (daily at 08:30):
 *   30 8 * * * node /app/src/workers/notificationDispatcher.worker.js
 */

require('dotenv').config();

const { buildFeeReminders }  = require('./feeReminder.service');
const { dispatchReminders }  = require('./notificationDispatcher.service');
const pool                   = require('../config/db');
const logger                 = require('../utils/logger');
const {
  checkThresholds,
  createBatch,
  updateBatchStatus,
} = require('../modules/notifications/messageBatch.service');

// ============================================================
// WORKER
// ============================================================

async function runNotificationDispatcher() {
  const startedAt = Date.now();
  logger.info('NotificationDispatcher: worker started');

  const report = {
    remindersBuilt: 0,
    sent:           0,
    failed:         0,
    skipped:        0,
    errors:         [],
  };

  // ── Step 1: Build reminder payloads ──────────────────────
  let reminders = [];
  try {
    reminders = await buildFeeReminders();
    report.remindersBuilt = reminders.length;
    logger.info('NotificationDispatcher: reminders built', { count: reminders.length });
  } catch (err) {
    logger.error('NotificationDispatcher: failed to build reminders', { error: err.message });
    report.errors.push({ phase: 'BUILD', message: err.message });
    return report;
  }

  if (reminders.length === 0) {
    logger.info('NotificationDispatcher: no reminders to dispatch today');
    return report;
  }

  // ── Step 2: Safety guardrail — threshold check ────────────
  // Workers cannot prompt for user confirmation.
  // If thresholds are exceeded the batch is ABORTED — no messages sent.
  const threshold = checkThresholds(reminders.length);

  const batch = await createBatch({
    organizationId: null,           // cross-org worker — no single org
    batchType:      'FEE_REMINDER',
    recipientCount: reminders.length,
    status:         threshold.exceeded ? 'ABORTED' : 'RUNNING',
  });

  if (threshold.exceeded) {
    logger.error('NotificationDispatcher: batch exceeds safety thresholds — ABORTED (no messages sent)', {
      recipientCount: reminders.length,
      estimatedCost:  threshold.estimatedCost,
      maxRecipients:  threshold.maxRecipients,
      maxCostInr:     threshold.maxCostInr,
      reasons:        threshold.reasons,
      batchId:        batch?.id,
      hint:           'Raise BATCH_MAX_RECIPIENTS or BATCH_MAX_COST_INR env vars if this run is legitimate.',
    });
    report.errors.push({ phase: 'THRESHOLD', message: threshold.reasons.join('; ') });
    return report;
  }

  logger.info('NotificationDispatcher: batch started', {
    batchId:        batch?.id,
    recipientCount: reminders.length,
    estimatedCost:  threshold.estimatedCost,
  });

  // ── Step 3: Dispatch notifications ───────────────────────
  try {
    const stats = await dispatchReminders(reminders);

    report.sent    = stats.sent;
    report.failed  = stats.failed;
    report.skipped = stats.skipped;

    const finalStatus = (stats.sent === 0 && stats.failed > 0) ? 'FAILED' : 'COMPLETED';
    await updateBatchStatus(batch?.id, finalStatus);

    logger.info('NotificationDispatcher: dispatch complete', {
      batchId:    batch?.id,
      sent:       stats.sent,
      failed:     stats.failed,
      skipped:    stats.skipped,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    // dispatchReminders should never throw, but guard regardless
    await updateBatchStatus(batch?.id, 'FAILED');
    logger.error('NotificationDispatcher: dispatch phase error', {
      batchId: batch?.id,
      error:   err.message,
    });
    report.errors.push({ phase: 'DISPATCH', message: err.message });
  }

  return report;
}

// ============================================================
// STANDALONE EXECUTION
// ============================================================

if (require.main === module) {
  runNotificationDispatcher()
    .then((report) => {
      logger.info('NotificationDispatcher: summary', {
        remindersBuilt: report.remindersBuilt,
        sent:           report.sent,
        failed:         report.failed,
        skipped:        report.skipped,
        errors:         report.errors.length,
      });
      process.exit(0);
    })
    .catch((err) => {
      logger.error('NotificationDispatcher: unhandled rejection', { error: err.message });
      process.exit(1);
    })
    .finally(async () => {
      await pool.end().catch((e) =>
        logger.error('NotificationDispatcher: pool close error', { error: e.message })
      );
    });
}

module.exports = { runNotificationDispatcher };
