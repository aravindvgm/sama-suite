'use strict';

/**
 * security.controller.js
 *
 * Phase-8.7 — Security Operations REST handlers.
 *
 * By the time these handlers run, the tenantStack has already executed:
 *   verifyToken → requireTenant → rateLimitMiddleware → requireActiveSubscription
 *
 * Request-scoped guarantees:
 *   req.user.id             — authenticated operator's user ID
 *   req.user.organizationId — resolved tenant (matches :organizationId param)
 *   req.params.organizationId — URL tenant scope
 *
 * Error handling:
 *   Application errors (4xx): service throws Error with .status + .message.
 *   Controller catches these and responds directly.
 *   Unexpected errors (5xx): forwarded to the global error handler via next(err).
 *   error.message is always a SCREAMING_SNAKE_CASE code string — never internal detail.
 */

const riskCaseService                          = require('../../services/riskCase.service');
const { ENDPOINT_GROUPS, evaluateRiskForVerify,
        mintStepUpToken }                      = require('../../services/endpointFriction.service');
const { increment, getRemainingTtl }           = require('../../middleware/redisRateLimiter.service');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Handle a known application error (err.status set) by the service,
 * or delegate to the global error handler for unexpected errors.
 */
function _handleError(err, res, next) {
  if (err.status) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  next(err);
}

// ── GET /risk-cases ───────────────────────────────────────────────────────────

/**
 * List risk cases for the organisation with optional status / riskLevel filter.
 *
 * Query params:
 *   status    — 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED'
 *   riskLevel — 'NORMAL' | 'ELEVATED' | 'HIGH' | 'CRITICAL'
 *   limit     — integer 1–100, default 20
 *   offset    — integer >= 0, default 0
 */
async function listCases(req, res, next) {
  try {
    const { organizationId } = req.params;
    const { status, riskLevel, limit, offset } = req.query;

    const result = await riskCaseService.listCases(organizationId, {
      status,
      riskLevel,
      limit,
      offset,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    _handleError(err, res, next);
  }
}

// ── GET /risk-cases/:caseId ───────────────────────────────────────────────────

/**
 * Return a single risk case with all linked behavioral_risk_events.
 */
async function getCase(req, res, next) {
  try {
    const { organizationId, caseId } = req.params;

    const riskCase = await riskCaseService.getCaseById(organizationId, caseId);
    if (!riskCase) {
      return res.status(404).json({ success: false, message: 'CASE_NOT_FOUND' });
    }

    return res.json({ success: true, data: riskCase });
  } catch (err) {
    _handleError(err, res, next);
  }
}

// ── POST /risk-cases/:caseId/acknowledge ──────────────────────────────────────

/**
 * Acknowledge an OPEN case.
 * No request body required.
 * Sets status = 'ACKNOWLEDGED', acknowledged_by = req.user.id.
 */
async function acknowledgeCase(req, res, next) {
  try {
    const { organizationId, caseId } = req.params;

    const result = await riskCaseService.acknowledgeCase(
      organizationId,
      caseId,
      req.user.id
    );

    return res.json({ success: true, data: result });
  } catch (err) {
    _handleError(err, res, next);
  }
}

// ── POST /risk-cases/:caseId/close ────────────────────────────────────────────

/**
 * Close an OPEN or ACKNOWLEDGED case.
 *
 * Body (JSON):
 *   closeReason  string  required, min 10 characters
 */
async function closeCase(req, res, next) {
  try {
    const { organizationId, caseId } = req.params;
    const { closeReason } = req.body;

    const result = await riskCaseService.closeCase(
      organizationId,
      caseId,
      req.user.id,
      closeReason
    );

    return res.json({ success: true, data: result });
  } catch (err) {
    _handleError(err, res, next);
  }
}

// ── POST /risk-events/:eventId/triage ────────────────────────────────────────

/**
 * Set the triage verdict on a single behavioral_risk_event.
 *
 * Body (JSON):
 *   triageStatus  'BENIGN' | 'SUSPICIOUS'   required
 *   triageNote    string                     optional
 */
async function triageEvent(req, res, next) {
  try {
    const { organizationId, eventId } = req.params;
    const { triageStatus, triageNote } = req.body;

    if (!triageStatus) {
      return res.status(400).json({ success: false, message: 'MISSING_TRIAGE_STATUS' });
    }

    const result = await riskCaseService.triageEvent(
      organizationId,
      eventId,
      triageStatus,
      triageNote,
      req.user.id
    );

    return res.json({ success: true, data: result });
  } catch (err) {
    _handleError(err, res, next);
  }
}

// ── POST /security/verify ─────────────────────────────────────────────────────

// Verify rate limit: 5 requests per 15-minute window per IP.
// Applied inside the handler (not via route-level middleware) so the
// Redis key is tenant-scoped (org + user) rather than bare IP.
const VERIFY_LIMIT      = 5;
const VERIFY_WINDOW_SEC = 15 * 60;  // 15 minutes in seconds

/**
 * Mint or refresh a step-up token for the requesting user.
 *
 * POST /api/:organizationId/security/verify
 *
 * Prerequisites (enforced by tenantStack + route):
 *   req.user.sub            — authenticated user ID (from JWT)
 *   req.user.organizationId — verified tenant (matches :organizationId)
 *
 * Request:
 *   Header: X-SAMA-Verify: 1          (CSRF protection)
 *   Body:   { endpointGroup: string } (must be in ENDPOINT_GROUPS registry)
 *
 * Rejected when:
 *   - X-SAMA-Verify header is absent or wrong value → 403 CSRF_CHECK_FAILED
 *   - endpointGroup unknown                         → 400 INVALID_ENDPOINT_GROUP
 *   - redirect in body/query with external URL      → 400 OPEN_REDIRECT_REJECTED
 *   - Rate limit exceeded (5 req / 15 min per user) → 429
 *   - Risk evaluation returns BLOCK                 → 403 RISK_BLOCKED
 *
 * On success:
 *   - UPSERTs endpoint_stepup_tokens (INSERT ON CONFLICT DO UPDATE)
 *   - Returns { success: true, endpointGroup, expiresAt }
 *   - Does NOT return risk score or risk level
 */
async function verifyStepUp(req, res, next) {
  try {
    const organizationId = req.params.organizationId;
    const userId         = req.user?.userId;

    // ── CSRF check ────────────────────────────────────────────────────────────
    // Custom header cannot be set by cross-origin HTML forms.
    // Angular's HttpClient must include this header on every verify request.
    if (req.headers['x-sama-verify'] !== '1') {
      return res.status(403).json({ success: false, message: 'CSRF_CHECK_FAILED' });
    }

    // ── Open redirect guard ───────────────────────────────────────────────────
    // The verify endpoint does not redirect; this guard prevents future
    // redirect-injection if the API evolves.
    const redirectParam = req.body?.redirect || req.query?.redirect || '';
    if (typeof redirectParam === 'string' && redirectParam.length > 0) {
      const trimmed = redirectParam.trim();
      if (trimmed.startsWith('//') || /^https?:\/\//i.test(trimmed)) {
        return res.status(400).json({ success: false, message: 'OPEN_REDIRECT_REJECTED' });
      }
    }

    // ── Endpoint group validation ─────────────────────────────────────────────
    const { endpointGroup } = req.body;
    if (!endpointGroup || typeof endpointGroup !== 'string') {
      return res.status(400).json({ success: false, message: 'MISSING_ENDPOINT_GROUP' });
    }
    if (!ENDPOINT_GROUPS.has(endpointGroup)) {
      return res.status(400).json({ success: false, message: 'INVALID_ENDPOINT_GROUP' });
    }

    // ── Per-user rate limit ───────────────────────────────────────────────────
    // Key scoped to (org, user) — not bare IP — to avoid punishing shared NATs.
    // Fails open on Redis outage (matches the pattern of rateLimitMiddleware).
    try {
      const verifyKey = `rate:verify:${organizationId}:${userId}`;
      const count     = await increment(verifyKey, VERIFY_WINDOW_SEC);

      if (count > VERIFY_LIMIT) {
        const ttlSec = await getRemainingTtl(verifyKey, VERIFY_WINDOW_SEC);
        return res
          .status(429)
          .set('Retry-After', String(Math.ceil(ttlSec)))
          .json({ success: false, message: 'VERIFY_RATE_LIMIT_EXCEEDED' });
      }
    } catch (_) {
      // Redis unavailable — fail open
    }

    // ── Risk evaluation (ignoring existing tokens) ────────────────────────────
    // evaluateRiskForVerify intentionally skips the endpoint_stepup_tokens
    // lookup. The verify flow IS the step-up; we check risk freshly.
    const { action, ttlMinutes, failOpen } = await evaluateRiskForVerify({
      organizationId,
      userId,
      endpointGroup,
    });

    // DB failure — refuse to mint without a confirmed risk read.
    // The guard (evaluateEndpointFriction) fails open to ALLOW because it is a
    // read-only check; the verify endpoint is the security decision point and
    // must not issue clearance it cannot substantiate.
    if (failOpen) {
      return res.status(503).json({ success: false, message: 'VERIFY_UNAVAILABLE' });
    }

    // BLOCK: refuse token minting unconditionally.
    if (action === 'BLOCK') {
      return res.status(403).json({ success: false, message: 'RISK_BLOCKED' });
    }

    // ALLOW or STEPUP: mint / refresh the step-up token.
    const { expiresAt } = await mintStepUpToken({
      organizationId,
      userId,
      endpointGroup,
      ttlMinutes,
    });

    return res.json({
      success:       true,
      endpointGroup,
      expiresAt,
    });

  } catch (err) {
    _handleError(err, res, next);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  listCases,
  getCase,
  acknowledgeCase,
  closeCase,
  triageEvent,
  verifyStepUp,
};
