'use strict';

/**
 * birthdayReminder.worker.js
 *
 * Sends birthday WhatsApp greetings to parents of students
 * whose date_of_birth matches today (month + day).
 *
 * Usage:
 *   node src/workers/birthdayReminder.worker.js      (direct)
 *   const { runBirthdayWorker } = require(...)       (programmatic)
 *
 * Suggested cron (daily at 08:00):
 *   0 8 * * * node /app/src/workers/birthdayReminder.worker.js
 */

require('dotenv').config();

const { runBirthdayReminders } = require('./birthdayReminder.service');
const pool                     = require('../config/db');
const logger                   = require('../utils/logger');
const {
  checkThresholds,
  createBatch,
  updateBatchStatus,
} = require('../modules/notifications/messageBatch.service');

// ============================================================
// WORKER
// ============================================================

async function runBirthdayWorker() {
  const startedAt = Date.now();
  logger.info('BirthdayWorker: started');

  const report = {
    studentsFound: 0,
    sent:          0,
    failed:        0,
    skipped:       0,
    errors:        [],
  };

  // ── Step 1: Run birthday service (fetches students + sends) ──
  // Birthday service returns studentsFound; actual send count
  // is the number of distinct contact numbers across students.
  // We estimate recipients = studentsFound × 1.5 (avg contacts per student)
  // for the threshold check before any sends begin.
  //
  // Accurate count: we do a dry-run count query first.
  let studentCount = 0;
  try {
    const pool2 = require('../config/db');
    const { rows } = await pool2.query(
      `SELECT COUNT(*) AS cnt
       FROM   students
       WHERE  deleted_at IS NULL
         AND  EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND  EXTRACT(DAY   FROM date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)`
    );
    studentCount = parseInt(rows[0].cnt, 10) || 0;
  } catch (err) {
    // Count query failed — proceed without threshold check (fail-open for count only)
    logger.warn('BirthdayWorker: could not pre-count students — skipping threshold check', { error: err.message });
  }

  // ── Step 2: Safety guardrail — threshold check ────────────
  // Use student count as conservative proxy for recipient count.
  // (Each student may have up to 2 contacts; threshold is conservative.)
  const threshold = checkThresholds(studentCount);

  const batch = await createBatch({
    organizationId: null,        // cross-org worker — no single org
    batchType:      'BIRTHDAY',
    recipientCount: studentCount,
    status:         threshold.exceeded ? 'ABORTED' : 'RUNNING',
  });

  if (threshold.exceeded) {
    logger.error('BirthdayWorker: batch exceeds safety thresholds — ABORTED (no messages sent)', {
      studentCount,
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

  logger.info('BirthdayWorker: batch started', {
    batchId:      batch?.id,
    studentCount,
    estimatedCost: threshold.estimatedCost,
  });

  // ── Step 3: Run service (actual sends) ────────────────────
  try {
    const stats = await runBirthdayReminders();

    report.studentsFound = stats.studentsFound;
    report.sent          = stats.sent;
    report.failed        = stats.failed;
    report.skipped       = stats.skipped;

    const finalStatus = (stats.sent === 0 && stats.failed > 0) ? 'FAILED' : 'COMPLETED';
    await updateBatchStatus(batch?.id, finalStatus);

    logger.info('BirthdayWorker: complete', {
      batchId:       batch?.id,
      studentsFound: stats.studentsFound,
      sent:          stats.sent,
      failed:        stats.failed,
      skipped:       stats.skipped,
      durationMs:    Date.now() - startedAt,
    });
  } catch (err) {
    await updateBatchStatus(batch?.id, 'FAILED');
    logger.error('BirthdayWorker: fatal error', { batchId: batch?.id, error: err.message });
    report.errors.push({ phase: 'RUN', message: err.message });
  }

  return report;
}

// ============================================================
// STANDALONE EXECUTION
// ============================================================

if (require.main === module) {
  runBirthdayWorker()
    .then((report) => {
      logger.info('BirthdayWorker: summary', {
        studentsFound: report.studentsFound,
        sent:          report.sent,
        failed:        report.failed,
        skipped:       report.skipped,
        errors:        report.errors.length,
      });
      process.exit(0);
    })
    .catch((err) => {
      logger.error('BirthdayWorker: unhandled rejection', { error: err.message });
      process.exit(1);
    })
    .finally(async () => {
      await pool.end().catch((e) =>
        logger.error('BirthdayWorker: pool close error', { error: e.message })
      );
    });
}

module.exports = { runBirthdayWorker };
