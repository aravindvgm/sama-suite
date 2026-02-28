'use strict';

const auditLogger = require('../modules/audit/auditLogger.service');

// ── PII masking ────────────────────────────────────────────────────────────────
// Mask ONLY well-known PII keys. Generic patterns are intentionally avoided
// to prevent false positives on legitimate business data.
const PII_KEYS = new Set([
  'contactNumber',
  'mobile',
  'phone',
  'email',
  'father_mobile',
  'mother_mobile',
]);

/**
 * Recursively mask PII values in a plain object.
 * Operates on a shallow clone — original object is not mutated.
 */
function maskPii(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;

  const masked = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_KEYS.has(key) && value != null) {
      masked[key] = '***';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskPii(value);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ── logAction ─────────────────────────────────────────────────────────────────
/**
 * Delegates to auditLogger.logEvent() — no direct DB access.
 *
 * requestId and ipAddress are folded into meta because auditLogger.logEvent()
 * does not carry separate transport fields.
 *
 * auditLogger.logEvent() is fail-open and never throws — this function
 * preserves that contract without wrapping in an additional try/catch.
 *
 * @param {object}  data
 * @param {string}  data.organizationId
 * @param {string}  [data.userId]        - human user UUID (USER actor)
 * @param {string}  [data.actorUserId]   - explicit actor UUID (takes precedence)
 * @param {string}  [data.actorType]     - 'USER' | 'SYSTEM' | 'AI'  (default: 'USER')
 * @param {string}  data.action
 * @param {string}  data.entityType
 * @param {string}  data.entityId
 * @param {object}  [data.meta]          - lightweight change summary (PII will be masked)
 * @param {string}  [data.requestId]     - folded into meta
 * @param {string}  [data.ipAddress]     - folded into meta
 */
async function logAction({
  organizationId,
  userId       = null,
  actorUserId  = null,
  actorType    = 'USER',
  action,
  entityType,
  entityId,
  meta         = null,
  requestId    = null,
  ipAddress    = null,
}) {
  // Resolve actor user UUID: explicit actorUserId wins, then userId
  const resolvedActorUserId = actorUserId ?? userId ?? null;

  // PII-mask caller's meta, then enrich with transport fields
  const enrichedMeta = {
    ...(maskPii(meta) || {}),
    ...(requestId ? { requestId } : {}),
    ...(ipAddress ? { ipAddress } : {}),
  };

  await auditLogger.logEvent({
    organizationId,
    entityType,
    entityId,
    action,
    actor: {
      type:   actorType,
      // SYSTEM/AI actors must not carry userId — auditLogger validates this
      userId: actorType === 'USER' ? resolvedActorUserId : undefined,
    },
    meta: Object.keys(enrichedMeta).length > 0 ? enrichedMeta : null,
  });
}

// ── Backward-compatible alias ──────────────────────────────────────────────────
/**
 * log — legacy interface. All existing callers continue to work unchanged.
 * New code should call logAction() directly.
 */
async function log({
  organizationId,
  userId,
  action,
  entityType,
  entityId,
  meta      = null,
  ipAddress = null,
}) {
  return logAction({
    organizationId,
    userId,
    actorType:   'USER',
    actorUserId: userId,
    action,
    entityType,
    entityId,
    meta,
    ipAddress,
  });
}

module.exports = { logAction, log };
