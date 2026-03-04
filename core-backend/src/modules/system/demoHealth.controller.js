'use strict';

/**
 * demoHealth.controller.js
 *
 * GET /health/demo  — public, no auth required.
 *
 * Used by the demo operator to confirm all subsystems are reachable
 * before a live presentation starts.
 *
 * Response shape:
 *   {
 *     status:   "healthy" | "degraded",
 *     database: { status: "ok" | "error", latencyMs: number | null },
 *     redis:    { status: "ok" | "error" },
 *     uptime:   number   // Node process uptime in whole seconds
 *   }
 *
 * HTTP 200 when both subsystems are healthy.
 * HTTP 503 when any subsystem reports an error.
 */

const pool  = require('../../config/db');
const redis = require('../../config/redis');

async function getDemoHealth(_req, res) {
  const uptimeSeconds = Math.floor(process.uptime());

  // ── Database probe ─────────────────────────────────────────────────────────
  let dbStatus    = 'ok';
  let dbLatencyMs = null;
  try {
    const t0 = Date.now();
    await pool.query('SELECT 1');
    dbLatencyMs = Date.now() - t0;
  } catch {
    dbStatus = 'error';
  }

  // ── Redis probe ────────────────────────────────────────────────────────────
  let redisStatus = 'ok';
  try {
    await redis.ping();
  } catch {
    redisStatus = 'error';
  }

  // ── Response ───────────────────────────────────────────────────────────────
  const healthy = dbStatus === 'ok' && redisStatus === 'ok';

  res.status(healthy ? 200 : 503).json({
    status:   healthy ? 'healthy' : 'degraded',
    database: { status: dbStatus, latencyMs: dbLatencyMs },
    redis:    { status: redisStatus },
    uptime:   uptimeSeconds,
  });
}

/**
 * POST /health/demo/reset-cache  — localhost only (enforced in route).
 *
 * 1. Clears Redis keys matching attendance* (no data deleted — cache only).
 * 2. Cycles idle PostgreSQL connections (acquire + destroy, pool refills lazily).
 *
 * Response: { success, message, details: { redis, postgres } }
 */
async function resetDemoCache(_req, res) {
  const details = {};

  // ── Redis: delete attendance cache keys ────────────────────────────────────
  try {
    const keys = await redis.keys('attendance*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    details.redis = { keysCleared: keys.length };
  } catch (err) {
    details.redis = { error: err.message };
  }

  // ── PostgreSQL: cycle idle connections ─────────────────────────────────────
  // Acquire each idle client and destroy it (release(true)).
  // The pool creates fresh connections on next use — no active connections
  // are touched, no data is affected.
  try {
    const idleCount = pool.idleCount;
    for (let i = 0; i < idleCount; i++) {
      const client = await pool.connect();
      client.release(true); // true = destroy, not return to pool
    }
    details.postgres = { connectionsReset: idleCount };
  } catch (err) {
    details.postgres = { error: err.message };
  }

  res.json({
    success: true,
    message: 'Demo cache reset complete',
    details,
  });
}

module.exports = { getDemoHealth, resetDemoCache };
