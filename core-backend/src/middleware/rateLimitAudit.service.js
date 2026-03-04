'use strict';

const pool   = require('../config/db');
const logger = require('../utils/logger');

// ─── In-memory flood throttle ─────────────────────────────────────────────────
//
// Prevents audit log flooding when a single attacker hammers the same route.
// Same (type + identifier + route) combination is written at most once per
// THROTTLE_MS milliseconds regardless of how many 429s are returned.
//
// This Map is intentionally process-local. It is NOT shared across instances.
// That is acceptable because the audit table is append-only diagnostic data —
// a few duplicate rows from different pods are harmless. The goal is preventing
// a single node from generating thousands of identical audit rows per second.

const THROTTLE_MS = 5 * 1000; // 5 seconds
const throttleMap = new Map();

/**
 * Returns true if the event should be written to the audit table.
 * Updates the throttle Map as a side effect when returning true.
 *
 * @param {string} type        Rate limit type: 'ip' | 'user' | 'login'
 * @param {string} identifier  userId when available, otherwise ipAddress
 * @param {string} route       Request path
 * @returns {boolean}
 */
function shouldLog(type, identifier, route) {
  const key      = `${type}:${identifier}:${route}`;
  const lastSeen = throttleMap.get(key);
  const now      = Date.now();

  if (lastSeen !== undefined && now - lastSeen < THROTTLE_MS) {
    return false;
  }

  throttleMap.set(key, now);
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget insert into rate_limit_audit.
 *
 * Must be called without await — callers must never block on this.
 * All errors are caught and logged; they are never propagated.
 * Request bodies and tokens are never read or stored.
 *
 * @param {object}      params
 * @param {string|null} params.organizationId
 * @param {string|null} params.userId
 * @param {string}      params.ipAddress
 * @param {string}      params.route
 * @param {string}      params.method
 * @param {string}      params.rateLimitType   'ip' | 'user' | 'login'
 * @param {string}      params.userAgent
 */
function logRateLimitHit({
  organizationId = null,
  userId         = null,
  ipAddress,
  route,
  method,
  rateLimitType,
  userAgent      = '',
}) {
  const identifier = userId || ipAddress;

  if (!shouldLog(rateLimitType, identifier, route)) {
    return;
  }

  // Intentionally not awaited — fire and forget.
  pool.query(
    `INSERT INTO rate_limit_audit
       (organization_id, user_id, ip_address, route, method,
        rate_limit_type, user_agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [organizationId, userId, ipAddress, route, method, rateLimitType, userAgent],
  ).catch((err) => {
    // Swallowed intentionally — audit failure must never affect the response.
    logger.error('rateLimitAudit: insert failed', { error: err.message });
  });
}

module.exports = { logRateLimitHit };
