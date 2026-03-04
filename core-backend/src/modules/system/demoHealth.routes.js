'use strict';

/**
 * demoHealth.routes.js
 *
 * Mounted at: /health/demo
 *
 * Routes:
 *   GET  /health/demo               — subsystem status (DB, Redis, uptime)
 *   POST /health/demo/reset-cache   — clear Redis attendance keys + cycle idle PG connections
 *
 * Access control:
 *   All routes are restricted to localhost (127.0.0.1 / ::1) only.
 *   External IPs receive 403. No JWT required — demo VM operator use only.
 */

const express      = require('express');
const router       = express.Router();
const asyncHandler = require('../../utils/asyncHandler');
const controller   = require('./demoHealth.controller');

// ── Localhost guard ────────────────────────────────────────────────────────────
// Applied to every route in this file.
// req.ip honours X-Forwarded-For when Express trust proxy is set.
// On the demo VM, trust proxy is NOT set, so req.ip is the raw socket address.
// Normalise IPv6-mapped IPv4 (::ffff:127.0.0.1) before comparison.

function requireLocalhost(req, res, next) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  const ip  = raw.replace(/^::ffff:/, '');

  if (ip !== '127.0.0.1' && ip !== '::1') {
    return res.status(403).json({
      success: false,
      message: 'This endpoint is restricted to localhost.',
    });
  }
  next();
}

router.use(requireLocalhost);

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /health/demo
router.get('/', asyncHandler(controller.getDemoHealth));

// POST /health/demo/reset-cache
router.post('/reset-cache', asyncHandler(controller.resetDemoCache));

module.exports = router;
