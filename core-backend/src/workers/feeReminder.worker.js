'use strict';

/**
 * feeReminder.worker.js
 *
 * Daily worker — identifies upcoming / overdue fees and builds
 * notification payloads.  Does NOT send WhatsApp/SMS itself.
 * Callers (cron, queue processor) consume the returned payload array.
 *
 * Usage:
 *   node src/workers/feeReminder.worker.js          (direct execution)
 *   const { runFeeReminderWorker } = require(...)   (programmatic)
 */

require('dotenv').config();

const { buildFeeReminders } = require('./feeReminder.service');
const pool                  = require('../config/db');

// ============================================================
// WORKER
// ============================================================

async function runFeeReminderWorker() {
  const startedAt = new Date();
  console.log(`[FeeReminder] Worker started at ${startedAt.toISOString()}`);

  const result = {
    startedAt:    startedAt.toISOString(),
    completedAt:  null,
    totalFees:    0,
    reminders:    [],
    skipped:      0,
    errors:       [],
  };

  try {
    const reminders = await buildFeeReminders();

    result.reminders = reminders;
    result.totalFees = reminders.length;

    // ── Log summary grouped by org ──
    const byOrg = {};
    for (const r of reminders) {
      if (!byOrg[r.organizationId]) byOrg[r.organizationId] = { UPCOMING: 0, OVERDUE: 0 };
      byOrg[r.organizationId][r.reminderType]++;
    }

    for (const [orgId, counts] of Object.entries(byOrg)) {
      console.log(
        `[FeeReminder] Org ${orgId} — Upcoming: ${counts.UPCOMING}, Overdue: ${counts.OVERDUE}`
      );
    }

    console.log(`[FeeReminder] Total reminders prepared: ${reminders.length}`);

  } catch (err) {
    // Top-level catch — worker must never exit with uncaught error
    console.error('[FeeReminder] Worker encountered a fatal error:', err.message);
    result.errors.push({ level: 'FATAL', message: err.message, stack: err.stack });
  } finally {
    result.completedAt = new Date().toISOString();
    console.log(`[FeeReminder] Worker completed at ${result.completedAt}`);

    // Release pool when running as a standalone script
    if (require.main === module) {
      await pool.end().catch((e) => console.error('[FeeReminder] Pool close error:', e.message));
    }
  }

  return result;
}

// ============================================================
// STANDALONE EXECUTION
// node src/workers/feeReminder.worker.js
// ============================================================

if (require.main === module) {
  runFeeReminderWorker()
    .then((result) => {
      console.log('[FeeReminder] Result summary:', JSON.stringify({
        totalFees:   result.totalFees,
        startedAt:   result.startedAt,
        completedAt: result.completedAt,
        errors:      result.errors.length,
      }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[FeeReminder] Unhandled rejection:', err);
      process.exit(1);
    });
}

module.exports = { runFeeReminderWorker };
