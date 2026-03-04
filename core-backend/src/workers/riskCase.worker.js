'use strict';

/**
 * riskCase.worker.js
 *
 * Phase-8.7 periodic runner for risk-case synchronisation.
 *
 * Preferred execution: via jobScheduler.worker.js (distributed lock guarantees
 * single-instance execution per cycle).
 *
 * Standalone execution:
 *   node src/workers/riskCase.worker.js
 *   Runs immediately on start, then every 15 minutes via setInterval.
 *   Without the distributed lock, multiple instances running simultaneously
 *   would produce harmless duplicate no-op UPDATE/INSERT attempts — the
 *   partial unique index and NOT EXISTS guards in the service make all
 *   sync operations idempotent.
 *
 * Failure behaviour:
 *   - DB unavailable     → cycle skipped, warning logged, worker continues.
 *   - Individual step    → isolated by try/catch in syncRiskCases(); other
 *     failure             steps proceed normally.
 *   - Worker itself      → never crashes the process (uncaughtException handler).
 */

require('dotenv').config();

const logger = require('../utils/logger');
const { syncRiskCases: _sync } = require('../services/riskCase.service');

const WORKER_NAME = 'riskCase';
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ── Core run function ─────────────────────────────────────────────────────────

/**
 * Execute one full risk-case sync cycle.
 * Wraps the service layer, logs the outcome, never throws.
 *
 * @returns {Promise<void>}
 */
async function runRiskCaseSync() {
  logger.info(`${WORKER_NAME}: starting sync cycle`);

  let summary;

  try {
    summary = await _sync();
  } catch (err) {
    // _sync itself should not throw; this is a defensive catch.
    logger.warn(`${WORKER_NAME}: cycle failed — DB may be unavailable`, {
      error: err.message,
    });
    return;
  }

  logger.info(`${WORKER_NAME}: cycle complete`, {
    casesCreated: summary.casesCreated,
    casesUpdated: summary.casesUpdated,
    eventsLinked: summary.eventsLinked,
    errors:       summary.errors,
    durationMs:   summary.durationMs,
  });
}

// ── Standalone execution ──────────────────────────────────────────────────────

if (require.main === module) {
  runRiskCaseSync();

  const timer = setInterval(runRiskCaseSync, INTERVAL_MS);

  logger.info(`${WORKER_NAME}: started in standalone mode`, { intervalMs: INTERVAL_MS });

  async function shutdown(signal) {
    logger.info(`${WORKER_NAME}: shutting down`, { signal });
    clearInterval(timer);
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

module.exports = { runRiskCaseSync };
