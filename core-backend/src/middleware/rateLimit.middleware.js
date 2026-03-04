'use strict';

const logger              = require('../utils/logger');
const { increment,
        getRemainingTtl } = require('./redisRateLimiter.service');
const { logRateLimitHit } = require('./rateLimitAudit.service');

// ─── Limit Definitions ────────────────────────────────────────────────────────

const GLOBAL_IP_LIMIT  = 300;
const GLOBAL_IP_WINDOW = 60;        // 1 minute (seconds)

const USER_LIMIT       = 120;
const USER_WINDOW      = 60;        // 1 minute (seconds)

const LOGIN_LIMIT      = 10;
const LOGIN_WINDOW     = 5 * 60;    // 5 minutes (seconds)

// ─── Login route detection ────────────────────────────────────────────────────
// Matches POST /api/auth/<orgId>/login — adjust regex if route structure changes.

const LOGIN_PATH_RE = /\/auth\/[^/]+\/login$/i;

// ─── Response helper ──────────────────────────────────────────────────────────

function tooManyRequests(res, ttlSeconds) {
  return res
    .status(429)
    .set('Retry-After', String(Math.ceil(ttlSeconds)))
    .json({ error: 'Too many requests. Please try again later.' });
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * rateLimitMiddleware
 *
 * Three-layer Redis-backed rate limiter in a single middleware function.
 * Each layer fails open independently — a Redis outage allows traffic through
 * rather than locking out legitimate users.
 *
 * Layer 1 — Global IP throttle
 *   Key:    rate:ip:<ip>
 *   Limit:  300 req / 60 s
 *   Scope:  Every request regardless of auth state
 *   Goal:   Block scanners and volumetric brute force at the infrastructure level
 *
 * Layer 2 — Authenticated user throttle
 *   Key:    rate:user:<organizationId>:<userId>
 *   Limit:  120 req / 60 s
 *   Scope:  Applies only when req.user is populated (after verifyToken)
 *   Goal:   Contain compromised-account abuse without punishing shared IPs
 *
 * Layer 3 — Login endpoint throttle
 *   Key:    rate:login:<ip>:<email (lowercase)>
 *   Limit:  10 req / 300 s
 *   Scope:  POST to /auth/:orgId/login only
 *   Goal:   Block credential stuffing per IP + email pair
 *
 * Wire this AFTER attachOrganization (requireTenant) so that req.user and
 * req.params.organizationId are both available for the user-limiter key.
 *
 * Middleware order:
 *   verifyToken → requireTenant → rateLimitMiddleware → requirePermission → controller
 */
async function rateLimitMiddleware(req, res, next) {
  const ip        = req.ip || 'unknown';
  const route     = req.path;
  const method    = req.method;
  const userAgent = req.headers['user-agent'] || '';

  // Prefer JWT-decoded fields; fall back to route param for unauthenticated hits.
  const userId = req.user?.userId || null;
  const orgId  = req.user?.organizationId || req.params?.organizationId || null;

  // ── Layer 1: Global IP throttle ────────────────────────────────────────────

  try {
    const ipKey = `rate:ip:${ip}`;
    const count = await increment(ipKey, GLOBAL_IP_WINDOW);

    if (count > GLOBAL_IP_LIMIT) {
      const ttlSeconds = await getRemainingTtl(ipKey, GLOBAL_IP_WINDOW);

      logRateLimitHit({
        organizationId: orgId,
        userId,
        ipAddress:     ip,
        route,
        method,
        rateLimitType: 'ip',
        userAgent,
      });

      logger.warn('Rate limit exceeded: global IP', { ip, count, route });
      return tooManyRequests(res, ttlSeconds);
    }
  } catch (redisErr) {
    // Fail open — a Redis outage must not block legitimate users.
    logger.warn('rateLimitMiddleware: Redis unavailable (IP check), failing open', {
      ip,
      error: redisErr.message,
    });
  }

  // ── Layer 2: Authenticated user throttle ───────────────────────────────────

  if (userId && orgId) {
    try {
      const userKey = `rate:user:${orgId}:${userId}`;
      const count   = await increment(userKey, USER_WINDOW);

      if (count > USER_LIMIT) {
        const ttlSeconds = await getRemainingTtl(userKey, USER_WINDOW);

        logRateLimitHit({
          organizationId: orgId,
          userId,
          ipAddress:     ip,
          route,
          method,
          rateLimitType: 'user',
          userAgent,
        });

        logger.warn('Rate limit exceeded: user', { userId, orgId, count, route });
        return tooManyRequests(res, ttlSeconds);
      }
    } catch (redisErr) {
      logger.warn('rateLimitMiddleware: Redis unavailable (user check), failing open', {
        userId,
        error: redisErr.message,
      });
    }
  }

  // ── Layer 3: Login endpoint throttle ───────────────────────────────────────

  if (method === 'POST' && LOGIN_PATH_RE.test(route)) {
    // Email normalized to lowercase for consistent key scoping.
    const email    = (req.body?.email || '').toLowerCase().trim();
    const loginKey = `rate:login:${ip}:${email}`;

    try {
      const count = await increment(loginKey, LOGIN_WINDOW);

      if (count > LOGIN_LIMIT) {
        const ttlSeconds = await getRemainingTtl(loginKey, LOGIN_WINDOW);

        logRateLimitHit({
          organizationId: orgId,
          userId,
          ipAddress:     ip,
          route,
          method,
          rateLimitType: 'login',
          userAgent,
          // email deliberately excluded — not stored in audit table
        });

        logger.warn('Rate limit exceeded: login', {
          ip,
          emailProvided: email.length > 0,
          count,
        });
        return tooManyRequests(res, ttlSeconds);
      }
    } catch (redisErr) {
      logger.warn('rateLimitMiddleware: Redis unavailable (login check), failing open', {
        ip,
        error: redisErr.message,
      });
    }
  }

  next();
}

module.exports = rateLimitMiddleware;
