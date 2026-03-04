'use strict';

/**
 * behavioralRisk.worker.js
 *
 * Periodic runner for Phase-8.5 behavioral risk evaluation.
 * Runs one full signal-detection + scoring cycle every 15 minutes.
 *
 * Multi-instance behavior:
 *   When invoked from jobScheduler.worker.js the distributed job lock
 *   (INSERT … ON CONFLICT DO UPDATE WHERE expires_at < NOW()) ensures that
 *   only one instance executes per cycle. In standalone mode, each instance
 *   runs independently — duplicate event inserts are suppressed by the
 *   NOT EXISTS dedup guard in behavioralRisk.service.js.
 *
 * Failure behavior:
 *   - DB unavailable → cycle skipped, warning logged, worker continues.
 *   - Individual signal detector failure → isolated, others still run.
 *   - Worker itself never crashes the process.
 *
 * Usage (standalone):
 *   node src/workers/behavioralRisk.worker.js
 *
 * Usage (from jobScheduler — preferred for single-instance execution):
 *   const { runBehavioralRisk } = require('./behavioralRisk.worker');
 *   runJob('behavioral_risk', runBehavioralRisk);
 */

require('dotenv').config();

const logger = require('../utils/logger');
const { runBehavioralRisk: _evaluate } = require('../services/behavioralRisk.service');

const WORKER_NAME = 'behavioralRisk';
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── Core run function ─────────────────────────────────────────────────────────

/**
 * Execute one full behavioral risk evaluation cycle.
 *
 * Wraps the service layer, logs the summary, and swallows all errors so the
 * function is safe to call from a cron scheduler or setInterval.
 *
 * @returns {Promise<void>}
 */
async function runBehavioralRisk() {
  logger.info(`${WORKER_NAME}: starting evaluation cycle`);

  let summary;

  try {
    summary = await _evaluate();
  } catch (err) {
    // _evaluate itself should not throw, but guard defensively.
    logger.warn(`${WORKER_NAME}: cycle failed — DB may be unavailable`, {
      error: err.message,
    });
    return;
  }

  logger.info(`${WORKER_NAME}: cycle complete`, {
    usersProcessed: summary.usersProcessed,
    eventsInserted: summary.eventsInserted,
    errors:         summary.errors,
    durationMs:     summary.durationMs,
  });
}

// ── Standalone execution ──────────────────────────────────────────────────────

if (require.main === module) {
  // Run immediately on startup, then every 15 minutes.
  runBehavioralRisk();

  const timer = setInterval(runBehavioralRisk, INTERVAL_MS);

  logger.info(`${WORKER_NAME}: worker started in standalone mode`, {
    intervalMs: INTERVAL_MS,
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────

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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { runBehavioralRisk };
