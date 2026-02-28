'use strict';

/**
 * loginRateLimiter.middleware.js
 *
 * Three-layer brute-force and credential-stuffing protection for the
 * login endpoint.  Applied ONLY to POST /:organizationId/login.
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  Layer 1 │ Per-IP          │ 20 attempts  │ 15 min  │ 429   │
 * │  Layer 2 │ Per-email fails │  5 failures  │ 15 min  │ 423   │
 * │  Layer 3 │ IP + email      │  5 attempts  │ 10 min  │ 429   │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Storage: Redis (ioredis) — each key has a TTL so no cleanup
 * interval is required.  To swap to in-memory, replace the four
 * primitives (getCount / increment / setLock / resetKeys) below.
 *
 * Fail-open: if Redis is unreachable during pre-checks, the request
 * is allowed through rather than locking out all users.
 *
 * Logging: email is always SHA-256 hashed — never logged in plain text.
 */

const crypto = require('crypto');
const redis  = require('../config/redis');
const logger = require('../utils/logger');

// ============================================================
// CONFIGURATION
// ============================================================

const IP_WINDOW_S       = 15 * 60;   // 15 minutes
const IP_MAX            = 20;        // total attempts (success + fail)

const EMAIL_WINDOW_S    = 15 * 60;   // 15 minutes
const EMAIL_MAX_FAILS   = 5;         // failed attempts only

const COMBINED_WINDOW_S = 10 * 60;   // 10 minutes
const COMBINED_MAX      = 5;         // total attempts

const LOCK_TTL_S        = 15 * 60;   // 15-minute progressive lockout

// ============================================================
// REDIS KEY BUILDERS
// Short prefixes keep memory footprint small at scale.
// ============================================================

const K_IP       = (ip)    => `ll:ip:${ip}`;
const K_EMAIL    = (h)     => `ll:email:${h}`;
const K_COMBINED = (ip, h) => `ll:comb:${ip}:${h}`;
const K_LOCK     = (h)     => `ll:lock:${h}`;

// ============================================================
// STORAGE PRIMITIVES
// Replace these four functions to swap storage backend.
// ============================================================

async function getCount(key) {
  const v = await redis.get(key);
  return v ? parseInt(v, 10) : 0;
}

async function increment(key, windowSec) {
  const count = await redis.incr(key);
  if (count === 1) {
    // Set TTL on first write — subsequent increments inherit it
    await redis.expire(key, windowSec);
  }
  return count;
}

async function setLock(key, ttlSec) {
  await redis.set(key, '1', 'EX', ttlSec);
}

async function resetKeys(keys) {
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

// ============================================================
// EMAIL HASHING HELPER
// ============================================================

function hashEmail(raw) {
  return crypto.createHash('sha256').update(raw || '').digest('hex');
}

// ============================================================
// POST-LOGIN COUNTER LOGIC
//
// Called fire-and-forget after the response is sent.
// Errors are caught and logged — never propagated to the caller.
// ============================================================

async function handlePostLogin({ loginSucceeded, ip, emailHash, hasEmail, requestId }) {
  // Layer 1: IP counter increments on every attempt (success + fail)
  await increment(K_IP(ip), IP_WINDOW_S);

  if (loginSucceeded) {
    if (hasEmail) {
      // Reset all email-scoped counters and clear any lock
      await resetKeys([
        K_EMAIL(emailHash),
        K_COMBINED(ip, emailHash),
        K_LOCK(emailHash),
      ]);
      logger.info('Login succeeded — rate limit counters reset', {
        requestId,
        ip,
        emailHash,
      });
    }
    return;
  }

  // ── Failed login ─────────────────────────────────────────
  if (!hasEmail) return;

  // Layer 3: IP + email combined counter
  await increment(K_COMBINED(ip, emailHash), COMBINED_WINDOW_S);

  // Layer 2: email fail counter → progressive lockout trigger
  const emailFails = await increment(K_EMAIL(emailHash), EMAIL_WINDOW_S);

  if (emailFails >= EMAIL_MAX_FAILS) {
    await setLock(K_LOCK(emailHash), LOCK_TTL_S);
    logger.warn('Login: email locked after repeated failures', {
      requestId,
      ip,
      emailHash,
      emailFails,
    });
  } else {
    logger.warn('Login failed — counters incremented', {
      requestId,
      ip,
      emailHash,
      emailFails,
    });
  }
}

// ============================================================
// MIDDLEWARE
// ============================================================

async function loginRateLimiter(req, res, next) {
  const ip        = req.ip;
  const rawEmail  = ((req.body && req.body.email) || '').toLowerCase().trim();
  const hasEmail  = rawEmail.length > 0;
  const emailHash = hashEmail(rawEmail);
  const requestId = req.requestId;

  // ── Pre-checks — fail open if Redis is unavailable ────────
  // A Redis outage must never lock out legitimate users.
  try {
    // ── Layer 1: Per-IP ──────────────────────────────────────
    const ipCount = await getCount(K_IP(ip));
    if (ipCount >= IP_MAX) {
      logger.warn('Login blocked: IP limit exceeded', { requestId, ip, emailHash });
      return res.status(429).json({
        success: false,
        message: 'Too many login attempts. Please try again later.',
      });
    }

    if (hasEmail) {
      // ── Progressive lockout ────────────────────────────────
      const locked = await redis.exists(K_LOCK(emailHash));
      if (locked) {
        logger.warn('Login blocked: account locked', { requestId, ip, emailHash });
        return res.status(423).json({
          success: false,
          message: 'Account temporarily locked due to repeated failed login attempts.',
        });
      }

      // ── Layer 3: IP + email combined ───────────────────────
      const combinedCount = await getCount(K_COMBINED(ip, emailHash));
      if (combinedCount >= COMBINED_MAX) {
        logger.warn('Login blocked: IP+email limit exceeded', { requestId, ip, emailHash });
        return res.status(429).json({
          success: false,
          message: 'Too many login attempts. Please try again later.',
        });
      }
    }
  } catch (redisErr) {
    logger.error('loginRateLimiter pre-check failed — failing open', {
      requestId,
      ip,
      emailHash,
      error: redisErr.message,
    });
    // Fall through and allow the request
  }

  // ── Response interceptor ──────────────────────────────────
  // Override res.json to capture whether the login succeeded
  // or failed, THEN send the response immediately.
  // Counter updates run asynchronously in the background.
  const originalJson = res.json.bind(res);

  res.json = function interceptLoginResponse(body) {
    // 2xx status and body.success !== false → login succeeded
    const loginSucceeded =
      res.statusCode >= 200 &&
      res.statusCode < 300 &&
      body != null &&
      body.success !== false;

    // Send the response without delay
    const result = originalJson(body);

    // Update counters after the response is on the wire
    handlePostLogin({ loginSucceeded, ip, emailHash, hasEmail, requestId }).catch((err) =>
      logger.error('loginRateLimiter post-login counter error', {
        requestId,
        ip,
        emailHash,
        error: err.message,
      })
    );

    return result;
  };

  next();
}

module.exports = loginRateLimiter;
