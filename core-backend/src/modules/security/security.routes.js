'use strict';

/**
 * security.routes.js
 *
 * Phase-8.7 — Security Operations REST routes.
 *
 * Mounted at: /api/:organizationId/security
 *
 * All routes in this file run AFTER tenantStack, which applies:
 *   verifyToken → tenantLimiter → requireTenant
 *   → rateLimitMiddleware → requireActiveSubscription
 *
 * DO NOT add verifyToken here — it is already applied by tenantStack.
 * The only middleware needed per-route is requirePermission.
 *
 * Permissions used:
 *   security.risk.read    — required for GET endpoints
 *   security.risk.manage  — required for state-transition + triage endpoints
 *
 * These permission keys must exist in the permissions table and be assigned
 * to appropriate roles (e.g. org_admin, security_officer) via role_permissions.
 */

const express = require('express');

const { requirePermission } = require('../../middleware/requirePermission');
const controller             = require('./security.controller');

const router = express.Router({ mergeParams: true });

// ── Read endpoints ────────────────────────────────────────────────────────────

// GET /api/:organizationId/security/risk-cases
// List cases with optional ?status=&riskLevel=&limit=&offset= filters.
router.get(
  '/risk-cases',
  requirePermission('security.risk.read'),
  controller.listCases
);

// GET /api/:organizationId/security/risk-cases/:caseId
// Single case with all linked behavioral_risk_events.
router.get(
  '/risk-cases/:caseId',
  requirePermission('security.risk.read'),
  controller.getCase
);

// ── Case state transitions ────────────────────────────────────────────────────

// POST /api/:organizationId/security/risk-cases/:caseId/acknowledge
// No body required.  Transitions OPEN → ACKNOWLEDGED.
router.post(
  '/risk-cases/:caseId/acknowledge',
  requirePermission('security.risk.manage'),
  controller.acknowledgeCase
);

// POST /api/:organizationId/security/risk-cases/:caseId/close
// Body: { closeReason: string (min 10 chars) }
// Transitions OPEN or ACKNOWLEDGED → CLOSED.
router.post(
  '/risk-cases/:caseId/close',
  requirePermission('security.risk.manage'),
  controller.closeCase
);

// ── Event triage ──────────────────────────────────────────────────────────────

// POST /api/:organizationId/security/risk-events/:eventId/triage
// Body: { triageStatus: 'BENIGN'|'SUSPICIOUS', triageNote?: string }
// Sets triage verdict on a single behavioral_risk_events row.
router.post(
  '/risk-events/:eventId/triage',
  requirePermission('security.risk.manage'),
  controller.triageEvent
);

// ── Step-up verification — Phase-9.B ─────────────────────────────────────────
//
// POST /api/:organizationId/security/verify
//
// Mints or refreshes a step-up clearance token for the requesting user.
// Called by the client when a protected endpoint returns 403 RISK_STEP_UP_REQUIRED.
//
// Security controls (all enforced in controller):
//   - Header: X-SAMA-Verify: 1          (CSRF protection)
//   - endpointGroup validated against ENDPOINT_GROUPS registry
//   - redirect param inspected for open redirect injection
//   - Per-user rate limit: 5 req / 15 min (Redis, fail-open)
//   - Risk re-evaluated ignoring existing tokens
//   - BLOCK decision → 403 RISK_BLOCKED (token not minted)
//
// No permission guard: any authenticated, tenant-verified user may call this.
// The friction decision itself gates whether a token is issued.
//
// Does NOT require requirePermission — access is governed by risk evaluation.
router.post(
  '/verify',
  controller.verifyStepUp
);

module.exports = router;
