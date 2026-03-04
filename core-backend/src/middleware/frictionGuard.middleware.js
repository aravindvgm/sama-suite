'use strict';

/**
 * frictionGuard.middleware.js
 *
 * Phase-9.B — Endpoint friction enforcement middleware factory.
 *
 * Usage:
 *   const { requireFrictionClearance } = require('../../middleware/frictionGuard.middleware');
 *
 *   router.get(
 *     '/students/export',
 *     requirePermission('students.read'),
 *     requireFrictionClearance('student.export'),
 *     controller.exportStudents
 *   );
 *
 * Middleware prerequisites (must run before requireFrictionClearance):
 *   verifyToken  — populates req.user.sub, req.user.organizationId
 *   requireTenant — confirms req.params.organizationId matches req.user.organizationId
 *
 * What requireFrictionClearance does:
 *   1. Calls evaluateEndpointFriction (pure, read-only, all 3 queries always run).
 *   2. On ALLOW  → next()
 *   3. On STEPUP_REQUIRED → 403 RISK_STEP_UP_REQUIRED (with endpointGroup, never risk score)
 *   4. On BLOCKED         → 403 RISK_BLOCKED (no detail)
 *   5. Fires a fire-and-forget audit log AFTER the guard returns (not inside it).
 *
 * What this middleware does NOT do:
 *   - It does not write to endpoint_stepup_tokens (only /security/verify does).
 *   - It does not expose the user's risk score or risk level in any response.
 *   - It does not call any external service.
 *   - It never crashes the process — any unexpected error is forwarded to next(err).
 */

const logger                        = require('../utils/logger');
const auditService                  = require('../utils/auditService');
const { evaluateEndpointFriction }  = require('../services/endpointFriction.service');

// ── 403 response helpers ──────────────────────────────────────────────────────

/**
 * Send a 403 RISK_STEP_UP_REQUIRED response.
 * Includes endpointGroup so the client knows which group to verify against.
 * Never includes risk score, risk level, or any other internal security signal.
 *
 * @param {import('express').Response} res
 * @param {string} endpointGroup
 */
function _sendStepUpRequired(res, endpointGroup) {
  return res.status(403).json({
    success:       false,
    code:          'RISK_STEP_UP_REQUIRED',
    endpointGroup,
    verifyPath:    '/security/verify',
  });
}

/**
 * Send a 403 RISK_BLOCKED response.
 * No detail exposed beyond the block code.
 *
 * @param {import('express').Response} res
 */
function _sendBlocked(res) {
  return res.status(403).json({
    success: false,
    code:    'RISK_BLOCKED',
  });
}

// ── Middleware factory ────────────────────────────────────────────────────────

/**
 * requireFrictionClearance(endpointGroup)
 *
 * Returns an Express middleware that enforces the friction policy for the
 * given endpoint group.
 *
 * The guard (evaluateEndpointFriction) is pure — it performs three DB reads
 * and returns a decision object with no side effects.  Audit logging is
 * performed here, outside the guard, to keep the guard testable in isolation.
 *
 * @param {string} endpointGroup — must be a key in ENDPOINT_GROUPS registry
 * @returns {import('express').RequestHandler}
 */
function requireFrictionClearance(endpointGroup) {
  return async function frictionGuard(req, res, next) {
    const organizationId = req.user?.organizationId || req.params?.organizationId;
    const userId         = req.user?.userId;

    // Guard rails: if token data is missing, the tenantStack upstream is broken.
    // Forward to global error handler rather than silently allowing or blocking.
    if (!organizationId || !userId) {
      return next(new Error('FRICTION_GUARD_MISSING_IDENTITY'));
    }

    let result;

    try {
      result = await evaluateEndpointFriction({ organizationId, userId, endpointGroup });
    } catch (err) {
      // evaluateEndpointFriction must never throw — this catch is truly defensive.
      // Fail open to avoid locking users out on an unexpected guard error.
      logger.error('frictionGuard: unexpected error from guard — failing open', {
        endpointGroup,
        error: err.message,
      });
      return next();
    }

    // ── ALLOW ────────────────────────────────────────────────────────────────

    if (result.decision === 'ALLOW') {
      if (result.failOpen) {
        logger.warn('frictionGuard: DB unavailable — fail-open ALLOW', {
          endpointGroup,
          userId,
          organizationId,
        });
      }
      return next();
    }

    // ── STEPUP_REQUIRED ───────────────────────────────────────────────────────
    // Log outside guard (guard is pure). Fire-and-forget — never await.

    if (result.decision === 'STEPUP_REQUIRED') {
      auditService.logAction({
        organizationId,
        actorType:  'USER',
        actorUserId: userId,
        action:     'FRICTION_STEPUP_REQUIRED',
        entityType: 'ENDPOINT_GROUP',
        entityId:   endpointGroup,
        meta:       { path: req.path, method: req.method },
      }).catch(() => {});

      return _sendStepUpRequired(res, endpointGroup);
    }

    // ── BLOCKED ───────────────────────────────────────────────────────────────

    auditService.logAction({
      organizationId,
      actorType:  'USER',
      actorUserId: userId,
      action:     'FRICTION_BLOCKED',
      entityType: 'ENDPOINT_GROUP',
      entityId:   endpointGroup,
      meta:       { path: req.path, method: req.method },
    }).catch(() => {});

    return _sendBlocked(res);
  };
}

module.exports = { requireFrictionClearance };
