'use strict';

const pool   = require('../config/db');
const logger = require('../utils/logger');

// ─── Allowed reasons ──────────────────────────────────────────────────────────
// Must match the CHECK constraint in migration 025.

const VALID_REASONS = new Set([
  'refresh_reuse_detected',
  'concurrent_session_evicted',
  'admin_session_revocation',
]);

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Appends a row to session_security_audit.
 *
 * MUST be called without await — this is fire-and-forget.
 * All errors are swallowed silently so audit failure never blocks auth.
 * Request bodies and tokens are never stored here.
 *
 * @param {object}      params
 * @param {string}      params.organizationId
 * @param {string}      params.userId
 * @param {string|null} [params.ipAddress]
 * @param {string}      params.reason  - 'refresh_reuse_detected' | 'concurrent_session_evicted' | 'admin_session_revocation'
 */
function logSessionEvent({ organizationId, userId, ipAddress = null, reason }) {
  if (!VALID_REASONS.has(reason)) {
    // Bad caller — log internally, do not write corrupt row.
    logger.error('sessionAudit: unknown reason, skipping write', { reason });
    return;
  }

  // Intentionally not awaited.
  pool.query(
    `INSERT INTO session_security_audit
       (organization_id, user_id, ip_address, reason, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [organizationId, userId, ipAddress, reason],
  ).catch((err) => {
    // Swallowed — audit failure must never affect the caller.
    logger.error('sessionAudit: insert failed', {
      reason,
      error: err.message,
    });
  });
}

module.exports = { logSessionEvent };
