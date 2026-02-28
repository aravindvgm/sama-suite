'use strict';

/**
 * anomalyDetection.worker.js
 *
 * Governance anomaly detection worker.
 *
 * Scans audit_logs for the last 15 minutes and emits structured
 * logger.error('ANOMALY_ALERT', ...) entries for any of the following:
 *
 *   1. HIGH risk action performed outside business hours (08:00–19:00 server time)
 *   2. ADMIN deleting USER   (absolute rule — any time of day)
 *   3. ADMIN deleting STAFF  (absolute rule — any time of day)
 *   4. Same actor_user_id performed > 3 HIGH risk actions within any 10-minute
 *      rolling window inside the scan period
 *
 * riskLevel is read from the meta JSONB column: meta->>'riskLevel'
 *
 * Fail-open contract:
 *   - DB errors → logger.warn; worker continues / returns
 *   - Never throws
 *
 * Usage (standalone):
 *   node src/workers/anomalyDetection.worker.js
 *
 * Usage (scheduled via jobScheduler):
 *   const { runAnomalyDetection } = require('./anomalyDetection.worker');
 *   cron.schedule('*\/15 * * * *', () => runAnomalyDetection());
 */

require('dotenv').config();

const pool   = require('../config/db');
const logger = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

const WORKER_NAME          = 'anomalyDetection';
const SCAN_WINDOW_MINUTES  = 15;
const BURST_WINDOW_MINUTES = 10;
const BURST_THRESHOLD      = 3;   // > 3 HIGH risk actions → alert
const BUSINESS_HOUR_START  = 8;   // 08:00 inclusive
const BUSINESS_HOUR_END    = 19;  // 19:00 exclusive

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when the given Date falls outside business hours on
 * the server's local clock (hour < 8 OR hour >= 19).
 *
 * @param {Date} date
 * @returns {boolean}
 */
function _isOutsideBusinessHours(date) {
  const hour = date.getHours();
  return hour < BUSINESS_HOUR_START || hour >= BUSINESS_HOUR_END;
}

/**
 * Emit a structured anomaly alert via logger.error.
 *
 * @param {string} anomalyType  Short machine-readable label
 * @param {object} details      All context fields
 */
function _alert(anomalyType, details) {
  logger.error('ANOMALY_ALERT', {
    anomalyType,
    detectedAt: new Date().toISOString(),
    ...details,
  });
}

// ── Core detection ────────────────────────────────────────────────────────────

/**
 * Fetch all audit rows from the last SCAN_WINDOW_MINUTES minutes.
 *
 * Columns retrieved:
 *   id, organization_id, entity_type, action, actor_type, actor_user_id,
 *   created_at, meta->>'riskLevel' AS risk_level
 *
 * @returns {Promise<object[]>}  Raw rows, or [] on DB error (fail-open)
 */
async function _fetchRecentRows() {
  try {
    const result = await pool.query(
      `SELECT id,
              organization_id,
              entity_type,
              action,
              actor_type,
              actor_user_id,
              created_at,
              meta->>'riskLevel' AS risk_level
         FROM audit_logs
        WHERE created_at >= NOW() - INTERVAL '${SCAN_WINDOW_MINUTES} minutes'
        ORDER BY created_at ASC`
    );
    return result.rows;
  } catch (err) {
    logger.warn(`${WORKER_NAME}: DB error fetching recent audit rows`, {
      error: err.message,
    });
    return [];
  }
}

/**
 * Rule 1 — HIGH risk action outside business hours.
 * Fires for every individual row that matches.
 *
 * @param {object[]} rows
 */
function _detectOutOfHoursHighRisk(rows) {
  for (const row of rows) {
    if (row.risk_level !== 'HIGH') continue;

    const createdAt = new Date(row.created_at);
    if (!_isOutsideBusinessHours(createdAt)) continue;

    _alert('HIGH_RISK_OUT_OF_HOURS', {
      auditId:        row.id,
      organizationId: row.organization_id,
      entityType:     row.entity_type,
      action:         row.action,
      actorType:      row.actor_type,
      actorUserId:    row.actor_user_id,
      createdAt:      row.created_at,
      riskLevel:      row.risk_level,
      reason:         'HIGH risk action performed outside business hours (08:00–19:00)',
    });
  }
}

/**
 * Rule 2 — ADMIN deleting USER (absolute, any time).
 * Rule 3 — ADMIN deleting STAFF (absolute, any time).
 *
 * Both derived from the stored action + entity_type fields, not from riskLevel,
 * so they fire even if meta is missing or malformed.
 *
 * @param {object[]} rows
 */
function _detectSensitiveAdminDeletes(rows) {
  const SENSITIVE = new Set(['USER', 'STAFF']);

  for (const row of rows) {
    if (row.action !== 'DELETE') continue;
    if (!SENSITIVE.has(row.entity_type)) continue;
    // If riskLevel is present but is not HIGH, skip — not an ADMIN-sourced delete
    if (row.risk_level && row.risk_level !== 'HIGH') continue;

    _alert('SENSITIVE_ADMIN_DELETE', {
      auditId:        row.id,
      organizationId: row.organization_id,
      entityType:     row.entity_type,
      action:         row.action,
      actorType:      row.actor_type,
      actorUserId:    row.actor_user_id,
      createdAt:      row.created_at,
      riskLevel:      row.risk_level,
      reason:         `Actor deleted ${row.entity_type} — requires immediate review`,
    });
  }
}

/**
 * Rule 4 — More than BURST_THRESHOLD HIGH risk actions by the same
 * actor_user_id within any BURST_WINDOW_MINUTES rolling window.
 *
 * Algorithm (sliding window, O(n) per actor):
 *   Group HIGH risk rows by actor_user_id.
 *   For each actor (already sorted ASC by the DB query):
 *     For each row i, advance j while created_at[j] - created_at[i] <=
 *     BURST_WINDOW_MS. If window count > BURST_THRESHOLD → alert once per actor.
 *
 * @param {object[]} rows
 */
function _detectHighRiskBursts(rows) {
  const highRows = rows.filter(r => r.risk_level === 'HIGH' && r.actor_user_id);

  // Group by actor
  const byActor = new Map();
  for (const row of highRows) {
    if (!byActor.has(row.actor_user_id)) byActor.set(row.actor_user_id, []);
    byActor.get(row.actor_user_id).push(row);
  }

  const burstWindowMs = BURST_WINDOW_MINUTES * 60 * 1000;

  for (const [actorUserId, actorRows] of byActor) {
    let alerted = false;

    for (let i = 0; i < actorRows.length && !alerted; i++) {
      const windowStart = new Date(actorRows[i].created_at).getTime();
      let count = 1;

      for (let j = i + 1; j < actorRows.length; j++) {
        const ts = new Date(actorRows[j].created_at).getTime();
        if (ts - windowStart > burstWindowMs) break;
        count += 1;
      }

      if (count > BURST_THRESHOLD) {
        alerted = true; // Emit once per actor per scan run
        _alert('HIGH_RISK_BURST', {
          actorUserId,
          organizationId:  actorRows[i].organization_id,
          highRiskCount:   count,
          windowMinutes:   BURST_WINDOW_MINUTES,
          burstStartedAt:  actorRows[i].created_at,
          reason:          `Actor performed ${count} HIGH risk actions within ${BURST_WINDOW_MINUTES} minutes`,
        });
      }
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run all anomaly detection rules against the last 15 minutes of audit_logs.
 * Each rule is wrapped in its own try/catch so a failure in one rule does not
 * suppress alerts from the others.
 *
 * @returns {Promise<void>}
 */
async function runAnomalyDetection() {
  logger.info(`${WORKER_NAME}: starting anomaly detection scan`, {
    scanWindowMinutes: SCAN_WINDOW_MINUTES,
  });

  const startedAt = Date.now();

  const rows = await _fetchRecentRows();

  if (rows.length === 0) {
    logger.info(`${WORKER_NAME}: no audit rows in scan window — nothing to analyse`);
    return;
  }

  try {
    _detectOutOfHoursHighRisk(rows);
  } catch (err) {
    logger.warn(`${WORKER_NAME}: error in out-of-hours rule`, { error: err.message });
  }

  try {
    _detectSensitiveAdminDeletes(rows);
  } catch (err) {
    logger.warn(`${WORKER_NAME}: error in sensitive-delete rule`, { error: err.message });
  }

  try {
    _detectHighRiskBursts(rows);
  } catch (err) {
    logger.warn(`${WORKER_NAME}: error in burst-detection rule`, { error: err.message });
  }

  logger.info(`${WORKER_NAME}: scan complete`, {
    rowsAnalysed: rows.length,
    elapsedMs:    Date.now() - startedAt,
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { runAnomalyDetection };

// ── Standalone execution ──────────────────────────────────────────────────────

if (require.main === module) {
  runAnomalyDetection()
    .then(() => process.exit(0))
    .catch(err => {
      logger.error(`${WORKER_NAME}: unhandled top-level error`, { error: err.message });
      process.exit(1);
    });
}
