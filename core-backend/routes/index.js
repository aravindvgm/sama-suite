"use strict";

/**
 * routes/index.js — central route aggregator
 *
 * server.js mounts this router at /api.
 * All paths here are therefore relative to /api.
 */

const express = require("express");
const router  = express.Router();

// ── Middleware singletons ──────────────────────────────────────────────────────

const verifyToken               = require("../src/middleware/auth.middleware");
const requireTenant             = require("../src/middleware/organization.middleware");
const requireActiveSubscription = require("../src/middleware/requireActiveSubscription");
const rateLimitMiddleware       = require("../src/middleware/rateLimit.middleware");
const tenantRateLimiter         = require("../src/middleware/tenantRateLimiter");
const authLimiter               = require("../src/middleware/rateLimiter").authLimiter;

// ── Route modules ─────────────────────────────────────────────────────────────

const authRoutes        = require("../src/modules/auth/auth.routes");
const meRoutes          = require("../src/modules/me/me.routes");
const usersRoutes       = require("../src/modules/users/users.routes");
const billingRoutes     = require("../src/modules/billing/billing.routes");
const analyticsRoutes   = require("../src/modules/billing/analytics.routes");
const securityRoutes    = require("../src/modules/security/security.routes");
const classesRoutes     = require("../src/modules/classes/classes.routes");
const enrollmentsRoutes = require("../src/modules/enrollments/enrollments.routes");
const attendanceRoutes  = require("../src/modules/attendance/attendance.routes");

// ── Tenant middleware stack ────────────────────────────────────────────────────

const tenantStack = [
  verifyToken,
  tenantRateLimiter,
  requireTenant,
  rateLimitMiddleware,
  requireActiveSubscription,
];

// ── Health probe (public) ─────────────────────────────────────────────────────

router.get("/health", (_req, res) => {
  res.json({
    success:   true,
    service:   "SAMA-SUITE Backend",
    status:    "running",
    timestamp: new Date().toISOString(),
  });
});

// ── Auth (public, rate-limited) ───────────────────────────────────────────────

router.use("/auth", authLimiter, authRoutes);

// ── Authenticated user routes ─────────────────────────────────────────────────

router.use("/users", verifyToken, meRoutes);
router.use("/org",   verifyToken, usersRoutes);

// ── Tenant-scoped routes ──────────────────────────────────────────────────────

router.use("/:organizationId/billing",     tenantStack, billingRoutes);
router.use("/:organizationId/reports",     tenantStack, analyticsRoutes);
router.use("/:organizationId/security",    tenantStack, securityRoutes);
router.use("/:organizationId/classes",     tenantStack, classesRoutes);
router.use("/:organizationId/enrollments", tenantStack, enrollmentsRoutes);
router.use("/:organizationId/attendance",  tenantStack, attendanceRoutes);

module.exports = router;
