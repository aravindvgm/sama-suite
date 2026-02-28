'use strict';

/**
 * auditIntegrity.worker.js
 *
 * Periodic audit hash-chain verification worker.
 *
 * For every distinct organization (including NULL-org SYSTEM/AI rows) it reads
 * audit_logs in chronological order, recomputes the expected record_hash for
 * each row from its canonical fields, and compares it against the stored value.
 *
 * Violations detected:
 *   - record_hash missing (row was written before migration 022 or hash UPDATE failed)
 *   - record_hash mismatch (row fields were tampered with after INSERT)
 *   - previous_hash broken link (this row's previous_hash ≠ predecessor's record_hash)
 *   - timestamp order violation (created_at is not monotonically non-decreasing)
 *
 * On any violation:
 *   logger.error is called with organizationId, auditId, and reason.
 *   Processing continues — a single bad row does not abort the rest of the chain.
 *
 * Batching:
 *   Rows are fetched 1,000 at a time per organisation to avoid large result sets.
 *
 * Fail-open:
 *   All DB errors are caught and logged as warnings. The worker never throws.
 *
 * Usage (standalone):
 *   node src/workers/auditIntegrity.worker.js
 *
 * Usage (scheduled via jobScheduler):
 *   const { runAuditIntegrity } = require('./auditIntegrity.worker');
 *   cron.schedule('0 2 * * *', () => runAuditIntegrity());
 */

require('dotenv').config();

const crypto = require('crypto');
const pool   = require('../config/db');
const logger = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE  = 1000;
const WORKER_NAME = 'auditIntegrity';

// ── Hash computation (must mirror auditLogger.service.js exactly) ─────────────

/**
 * Recompute the SHA-256 record_hash from the canonical field set.
 *
 * Canonical order (MUST match auditLogger.service.js _computeRecordHash):
 *   id | organization_id | entity_type | entity_id | action |
 *   actor_type | actor_user_id | created_at | previous_hash
 *
 * NULL values are represented as the literal string "NULL".
 *
 * @param {object} row  Raw row from audit_logs
 * @returns {string}    64-character lowercase hex digest
 */
function _recomputeHash(row) {
  const str = [
    row.id,
    row.organization_id,
    row.entity_type,
    row.entity_id,
    row.action,
    row.actor_type,
    row.actor_user_id,
    row.created_at,
    row.previous_hash,
  ]
    .map(v => (v === null || v === undefined ? 'NULL' : String(v)))
    .join('|');

  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ── Per-organisation chain verification ───────────────────────────────────────

/**
 * Verify the full hash chain for one organisation (or the NULL-org segment).
 *
 * @param {string|null} organizationId
 * @returns {Promise<{ checked: number, violations: number }>}
 */
async function _verifyOrgChain(organizationId) {
  let checked        = 0;
  let violations     = 0;
  let offset         = 0;
  let lastRecordHash = null;   // record_hash of the previous iteration's row
  let lastCreatedAt  = null;   // created_at of the previous iteration's row

  // Tenant-isolation WHERE mirrors the INSERT-time SELECT in auditLogger.service.js
  const whereClause = organizationId !== null
    ? 'WHERE organization_id = $1'
    : 'WHERE organization_id IS NULL';

  // For null-org queries we still need a placeholder-free path; use $1 only when
  // organizationId is non-null.
  const buildParams = (batchOffset) =>
    organizationId !== null
      ? [organizationId, BATCH_SIZE, batchOffset]
      : [BATCH_SIZE, batchOffset];

  const buildQuery = () =>
    organizationId !== null
      ? `SELECT id, organization_id, entity_type, entity_id, action,
                actor_type, actor_user_id, created_at,
                previous_hash, record_hash
           FROM audit_logs
          ${whereClause}
          ORDER BY created_at ASC, id ASC
          LIMIT $2 OFFSET $3`
      : `SELECT id, organization_id, entity_type, entity_id, action,
                actor_type, actor_user_id, created_at,
                previous_hash, record_hash
           FROM audit_logs
          ${whereClause}
          ORDER BY created_at ASC, id ASC
          LIMIT $1 OFFSET $2`;

  const query = buildQuery();

  while (true) {
    let rows;
    try {
      const result = await pool.query(query, buildParams(offset));
      rows = result.rows;
    } catch (err) {
      logger.warn(`${WORKER_NAME}: DB error fetching batch`, {
        organizationId,
        offset,
        error: err.message,
      });
      break; // Cannot continue this org's chain — move on
    }

    if (rows.length === 0) break;

    for (const row of rows) {
      checked += 1;

      // ── Violation 1: timestamp order ────────────────────────────────────────
      if (lastCreatedAt !== null && new Date(row.created_at) < new Date(lastCreatedAt)) {
        violations += 1;
        logger.error(`${WORKER_NAME}: timestamp order violation`, {
          organizationId,
          auditId:      row.id,
          reason:       'created_at is earlier than preceding row',
          rowCreatedAt: row.created_at,
          prevCreatedAt: lastCreatedAt,
        });
      }

      // ── Violation 2: missing record_hash ────────────────────────────────────
      if (!row.record_hash) {
        violations += 1;
        logger.error(`${WORKER_NAME}: missing record_hash`, {
          organizationId,
          auditId: row.id,
          reason:  'record_hash is NULL — row predates migration 022 or hash UPDATE failed',
        });
        // Cannot validate chain link without a stored hash; advance state and continue
        lastCreatedAt  = row.created_at;
        lastRecordHash = null;
        continue;
      }

      // ── Violation 3: broken previous_hash link ───────────────────────────────
      // The first row in a chain is expected to have previous_hash = NULL.
      // Every subsequent row must have previous_hash equal to the prior row's record_hash.
      if (lastRecordHash !== null && row.previous_hash !== lastRecordHash) {
        violations += 1;
        logger.error(`${WORKER_NAME}: broken previous_hash link`, {
          organizationId,
          auditId:           row.id,
          reason:            'previous_hash does not match predecessor record_hash',
          storedPrevHash:    row.previous_hash,
          expectedPrevHash:  lastRecordHash,
        });
      }

      // ── Violation 4: record_hash mismatch ───────────────────────────────────
      const expectedHash = _recomputeHash(row);
      if (row.record_hash !== expectedHash) {
        violations += 1;
        logger.error(`${WORKER_NAME}: record_hash mismatch`, {
          organizationId,
          auditId:       row.id,
          reason:        'recomputed hash does not match stored record_hash — possible tampering',
          storedHash:    row.record_hash,
          expectedHash,
        });
      }

      // Advance chain state regardless of violation (continue checking remaining rows)
      lastCreatedAt  = row.created_at;
      lastRecordHash = row.record_hash;
    }

    if (rows.length < BATCH_SIZE) break; // Last page
    offset += BATCH_SIZE;
  }

  return { checked, violations };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Discover all distinct organisations from audit_logs and verify each chain.
 * Also verifies the NULL-org segment (SYSTEM / AI actors).
 *
 * @returns {Promise<void>}
 */
async function runAuditIntegrity() {
  logger.info(`${WORKER_NAME}: starting audit hash-chain verification`);

  const startedAt = Date.now();
  let totalChecked    = 0;
  let totalViolations = 0;

  // ── Collect distinct organization_ids ───────────────────────────────────────
  let orgIds;
  try {
    const result = await pool.query(
      `SELECT DISTINCT organization_id
         FROM audit_logs
        ORDER BY organization_id ASC NULLS LAST`
    );
    orgIds = result.rows.map(r => r.organization_id); // includes null entries
  } catch (err) {
    logger.warn(`${WORKER_NAME}: failed to fetch distinct organizations — aborting`, {
      error: err.message,
    });
    return; // Fail-open
  }

  if (orgIds.length === 0) {
    logger.info(`${WORKER_NAME}: no audit_logs rows found — nothing to verify`);
    return;
  }

  // ── Verify each organisation's chain ────────────────────────────────────────
  for (const orgId of orgIds) {
    try {
      const { checked, violations } = await _verifyOrgChain(orgId);
      totalChecked    += checked;
      totalViolations += violations;

      if (violations === 0) {
        logger.info(`${WORKER_NAME}: chain OK`, {
          organizationId: orgId,
          rowsChecked:    checked,
        });
      } else {
        logger.error(`${WORKER_NAME}: chain violations found`, {
          organizationId: orgId,
          rowsChecked:    checked,
          violations,
        });
      }
    } catch (err) {
      // Individual org failure must not abort other orgs
      logger.warn(`${WORKER_NAME}: unexpected error verifying org chain`, {
        organizationId: orgId,
        error:          err.message,
      });
    }
  }

  const elapsedMs = Date.now() - startedAt;
  logger.info(`${WORKER_NAME}: verification complete`, {
    organizationsChecked: orgIds.length,
    totalRowsChecked:     totalChecked,
    totalViolations,
    elapsedMs,
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { runAuditIntegrity };

// ── Standalone execution ──────────────────────────────────────────────────────

if (require.main === module) {
  runAuditIntegrity()
    .then(() => process.exit(0))
    .catch(err => {
      // Should never reach here (runAuditIntegrity is fail-open), but safeguard
      logger.error(`${WORKER_NAME}: unhandled top-level error`, { error: err.message });
      process.exit(1);
    });
}
