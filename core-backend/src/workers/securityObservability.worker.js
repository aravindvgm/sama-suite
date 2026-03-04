'use strict';

/**
 * securityObservability.worker.js
 *
 * Periodic runner for Phase-8 security observability signals.
 * Evaluates all 7 anomaly signals every 5 minutes.
 *
 * Multi-instance behavior:
 *   Duplicate log entries are acceptable per spec.
 *   No distributed locking is used — each instance runs independently.
 *   To eliminate duplicates, add to jobScheduler.worker.js:
 *
 *     const { runSecurityObservability } = require('./securityObservability.worker');
 *     cron.schedule('*\/5 * * * *', () =>
 *       runJob('security_observability', runSecurityObservability).catch(...)
 *     , { timezone: TZ });
 *
 * Failure behavior:
 *   - DB unavailable → signals skipped, warning logged, worker continues.
 *   - Individual signal failure → isolated, other signals still run.
 *   - Worker itself never crashes the process.
 *
 * Usage (standalone):
 *   node src/workers/securityObservability.worker.js
 *
 * Usage (from jobScheduler — preferred for single-instance execution):
 *   const { runSecurityObservability } = require('./securityObservability.worker');
 *   runJob('security_observability', runSecurityObservability);
 */

require('dotenv').config();

const logger               = require('../utils/logger');
const { runAllSignals }    = require('../services/securityObservability.service');

const WORKER_NAME    = 'securityObservability';
const INTERVAL_MS    = 5 * 60 * 1000; // 5 minutes

// ─── Core run function ────────────────────────────────────────────────────────

/**
 * Executes one full cycle of all 7 security observability signals.
 *
 * Catches all errors from the service layer — this function itself
 * never throws so it is safe to call from a cron scheduler or setInterval.
 *
 * @returns {Promise<void>}
 */
async function runSecurityObservability() {
  logger.info(`${WORKER_NAME}: starting signal evaluation cycle`);

  let summary;

  try {
    summary = await runAllSignals();
  } catch (err) {
    // runAllSignals itself should not throw, but guard defensively.
    logger.warn(`${WORKER_NAME}: cycle failed — DB may be unavailable`, {
      error: err.message,
    });
    return;
  }

  logger.info(`${WORKER_NAME}: cycle complete`, {
    signalsFired: summary.signals,
    detectorErrors: summary.errors,
    durationMs:   summary.durationMs,
  });
}

// ─── Standalone execution ─────────────────────────────────────────────────────

if (require.main === module) {
  // Run immediately on startup, then every 5 minutes.
  runSecurityObservability();

  const timer = setInterval(runSecurityObservability, INTERVAL_MS);

  logger.info(`${WORKER_NAME}: worker started in standalone mode`, {
    intervalMs: INTERVAL_MS,
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  async function shutdown(signal) {
    logger.info(`${WORKER_NAME}: shutting down`, { signal });
    clearInterval(timer);
    // Allow in-flight cycle to finish naturally — no forced kill.
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error(`${WORKER_NAME}: uncaught exception (process continues)`, {
      error: err.message,
      stack: err.stack,
    });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`${WORKER_NAME}: unhandled rejection (process continues)`, {
      reason: String(reason),
    });
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { runSecurityObservability };
