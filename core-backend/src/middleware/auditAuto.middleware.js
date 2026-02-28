'use strict';

/**
 * auditAuto.middleware.js
 *
 * Automatic audit middleware — logs sensitive API mutations using auditLogger.
 *
 * Contract:
 *   - Must run AFTER auth middleware (requires req.user)
 *   - Silently skips if req.user is absent (unauthenticated or public routes)
 *   - GET requests are never audited
 *   - Audit is emitted inside res.on('finish') — only AFTER the response completes
 *   - Audit is emitted ONLY for successful responses (2xx–3xx)
 *   - Fire-and-forget: audit call is not awaited, never blocks the request
 *   - Fail-open: any error is logged via logger.warn; next() is always called
 *   - Does NOT modify app.js or any route files
 */

const auditLogger = require('../modules/audit/auditLogger.service');
const logger      = require('../utils/logger');

// ── Method → action mapping ────────────────────────────────────────────────────

const METHOD_ACTION = {
  POST:   'CREATE',
  PUT:    'UPDATE',
  PATCH:  'UPDATE',
  DELETE: 'DELETE',
};

// ── Entity detection from URL segments ────────────────────────────────────────
// Maps a lowercase URL segment to a canonical UPPER_SNAKE_CASE entity type.
// req.originalUrl segments are checked in order; first match wins.

const SEGMENT_ENTITY = {
  invoices:      'INVOICE',
  payments:      'PAYMENT',
  users:         'USER',
  subscriptions: 'SUBSCRIPTION',
  students:      'STUDENT',
  staff:         'STAFF',
  classes:       'CLASS',
  enrollments:   'ENROLLMENT',
  exams:         'EXAM',
  fees:          'FEE',
  adjustments:   'ADJUSTMENT',
  notifications: 'NOTIFICATION',
  templates:     'TEMPLATE',
  reports:       'REPORT',
};

/**
 * Derive entity type from a URL string.
 * Strips the query string, splits on '/', checks each segment against
 * SEGMENT_ENTITY. Returns 'UNKNOWN_ENTITY' if no known segment is found.
 *
 * @param {string} url  e.g. '/api/v1/invoices/123?foo=bar'
 * @returns {string}
 */
function _detectEntityType(url) {
  if (!url) return 'UNKNOWN_ENTITY';

  const pathname = url.split('?')[0].toLowerCase();
  const segments = pathname.split('/');

  for (const segment of segments) {
    if (SEGMENT_ENTITY[segment]) return SEGMENT_ENTITY[segment];
  }
  return 'UNKNOWN_ENTITY';
}

// ── Risk classification ────────────────────────────────────────────────────────

/**
 * Classify the risk level of a mutation based on actor role, action,
 * entity type, and entity identity.
 *
 * @param {object} params
 * @param {string} params.role        Actor's org role (e.g. 'ADMIN', 'TEACHER')
 * @param {string} params.action      Mapped action: CREATE | UPDATE | DELETE
 * @param {string} params.entityType  Detected entity type (e.g. 'USER', 'STUDENT')
 * @param {string|null} params.entityId  Resolved entity UUID or null
 * @param {string|null} params.userId    Authenticated user's own UUID
 * @returns {{ riskLevel: string, riskReason: string }}
 */
function _classifyRisk({ role, action, entityType, entityId, userId }) {
  const normalizedRole = (role || 'USER').toUpperCase();

  // 1. Self update (always LOW)
  if (entityType === 'USER' && entityId && entityId === userId) {
    return {
      riskLevel: 'LOW',
      riskReason: 'User updating own profile'
    };
  }

  // 2. ADMIN High-Risk Rules
  if (normalizedRole === 'ADMIN') {
    if (action === 'DELETE' && entityType === 'USER') {
      return { riskLevel: 'HIGH', riskReason: 'ADMIN deleting USER' };
    }

    if (action === 'UPDATE' && entityType === 'USER') {
      return { riskLevel: 'HIGH', riskReason: 'ADMIN modifying USER' };
    }

    if (action === 'DELETE' && entityType === 'SUBSCRIPTION') {
      return { riskLevel: 'HIGH', riskReason: 'ADMIN deleting SUBSCRIPTION' };
    }

    if (action === 'UPDATE' && entityType === 'SUBSCRIPTION') {
      return { riskLevel: 'HIGH', riskReason: 'ADMIN modifying SUBSCRIPTION' };
    }

    if (action === 'DELETE' && entityType === 'STAFF') {
      return { riskLevel: 'HIGH', riskReason: 'ADMIN deleting STAFF' };
    }

    if (action === 'DELETE' && entityType === 'STUDENT') {
      return { riskLevel: 'HIGH', riskReason: 'ADMIN deleting STUDENT' };
    }
  }

  // 3. Teacher Medium-Risk
  if (
    normalizedRole === 'TEACHER' &&
    entityType === 'STUDENT' &&
    action === 'UPDATE'
  ) {
    return {
      riskLevel: 'MEDIUM',
      riskReason: 'Teacher updating student record'
    };
  }

  // 4. Staff Medium-Risk
  if (
    normalizedRole === 'STAFF' &&
    entityType === 'STUDENT' &&
    action === 'UPDATE'
  ) {
    return {
      riskLevel: 'MEDIUM',
      riskReason: 'Staff updating student record'
    };
  }

  // 5. Default
  return {
    riskLevel: 'LOW',
    riskReason: 'Standard mutation — no elevated privilege rule matched'
  };
}

// ── Middleware ─────────────────────────────────────────────────────────────────

/**
 * Express middleware that emits a fire-and-forget audit event for every
 * mutating request (POST / PUT / PATCH / DELETE) made by an authenticated user,
 * but only once the response has finished and only when the status code
 * indicates success (200–399).
 *
 * Usage:
 *   router.use(auditAutoMiddleware);   // after auth middleware
 *   app.use('/api', authMiddleware, auditAutoMiddleware, apiRouter);
 *
 * @param {import('express').Request}      req
 * @param {import('express').Response}     res
 * @param {import('express').NextFunction} next
 */
function auditAutoMiddleware(req, res, next) {
  try {
    // 1. Skip if user context is absent (unauthenticated / public route)
    if (!req.user) {
      return next();
    }

    // 2. Skip reads — only mutations are audited
    const action = METHOD_ACTION[req.method];
    if (!action) {
      return next();
    }

    // 3. Capture request-time values before they may be mutated by later middleware
    const organizationId = req.user.organizationId || null;
    const userId         = req.user.userId || req.user.id || null;
    const role           = req.user.orgRole || 'USER';
    const entityType     = _detectEntityType(req.originalUrl || req.path);

    // entityId must be a string (UUID) or null — coerce non-string to null
    const rawEntityId =
      req.params?.id ||
      req.body?.id   ||
      req.query?.id  ||
      null;
    const entityId = rawEntityId && typeof rawEntityId === 'string'
      ? rawEntityId
      : null;

    const route     = req.originalUrl || req.url || null;
    const requestId = req.requestId   || null;

    // 4. Defer audit until the response has fully completed
    res.on('finish', () => {
      try {
        // Audit ONLY successful mutations (2xx–3xx)
        if (res.statusCode < 200 || res.statusCode >= 400) return;

        const { riskLevel, riskReason } = _classifyRisk({
          role,
          action,
          entityType,
          entityId,
          userId,
        });

        // Fire-and-forget — no await, no .catch() (auditLogger is fail-open)
        auditLogger.logEvent({
          organizationId,
          entityType,
          entityId,
          action,
          actor: {
            type:   'USER',
            userId,
          },
          meta: {
            method:     req.method,
            route,
            requestId,
            statusCode: res.statusCode,
            riskLevel,
            riskReason,
          },
        });
      } catch (err) {
        logger.warn('auditAutoMiddleware: error inside res.finish handler', {
          error:  err.message,
          method: req.method,
          url:    route,
        });
      }
    });

  } catch (err) {
    // Fail-open: middleware setup error must never block the request
    logger.warn('auditAutoMiddleware: unexpected setup error — request continues', {
      error:  err.message,
      method: req.method,
      url:    req.originalUrl || req.url,
    });
  }

  return next();
}

module.exports = { auditAutoMiddleware };
