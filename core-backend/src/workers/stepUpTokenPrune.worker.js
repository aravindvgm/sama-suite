'use strict';

/**
 * stepUpTokenPrune.worker.js
 *
 * Phase-9.B — Daily prune of expired endpoint_stepup_tokens rows.
 *
 * endpoint_stepup_tokens accumulates expired rows as users obtain and cycle
 * through step-up clearances.  Expired rows are functionally inert (the guard
 * applies AND expires_at > NOW() at read time) but degrade index performance
 * over time if left to accumulate indefinitely.
 *
 * Prune strategy:
 *   Batched DELETE of rows where expires_at < NOW() - INTERVAL '1 hour'.
 *   The 1-hour grace period avoids racing with in-flight requests that hold
 *   a reference to a row that expired milliseconds ago.
 *
 *   FOR UPDATE SKIP LOCKED prevents deadlocks when multiple scheduler
 *   instances run simultaneously (only one acquires the job lock, but
 *   the guard is belt-and-suspenders for correctness).
 *
 *   LIMIT 5000 per batch prevents long-running DELETE transactions that
 *   block concurrent writers.  Daily schedule ensures the batch is never
 *   close to the limit under normal load.
 *
 * Multi-instance behavior:
 *   When invoked from jobScheduler.worker.js the distributed job lock ensures
 *   only one instance executes per cycle.
 *
 * Never throws — DB errors are logged and the function resolves normally.
 *
 * Usage (from jobScheduler — preferred):
 *   const { runStepUpTokenPrune } = require('./stepUpTokenPrune.worker');
 *   runJob('stepup_token_prune', runStepUpTokenPrune);
 */

const pool   = require('../config/db');
const logger = require('../utils/logger');

const WORKER_NAME = 'stepUpTokenPrune';
const BATCH_SIZE  = 5000;

// ── Core run function ─────────────────────────────────────────────────────────

/**
 * Delete one batch of expired endpoint_stepup_tokens rows.
 *
 * @returns {Promise<{ rowsDeleted: number, durationMs: number }>}
 */
async function runStepUpTokenPrune() {
  const startedAt = Date.now();

  logger.info(`${WORKER_NAME}: starting prune cycle`);

  let rowsDeleted = 0;

  try {
    const { rowCount } = await pool.query(
      `WITH expired AS (
         SELECT id
           FROM endpoint_stepup_tokens
          WHERE expires_at < NOW() - INTERVAL '1 hour'
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM endpoint_stepup_tokens
        USING expired
        WHERE endpoint_stepup_tokens.id = expired.id`,
      [BATCH_SIZE]
    );

    rowsDeleted = rowCount || 0;
  } catch (err) {
    logger.error(`${WORKER_NAME}: prune query failed`, { error: err.message });
    // Return without rethrowing — caller (runJob) handles status logging.
    return { rowsDeleted: 0, durationMs: Date.now() - startedAt };
  }

  const durationMs = Date.now() - startedAt;

  logger.info(`${WORKER_NAME}: prune cycle complete`, {
    rowsDeleted,
    durationMs,
  });

  return { rowsDeleted, durationMs };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { runStepUpTokenPrune };
