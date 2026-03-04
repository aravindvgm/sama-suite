'use strict';

const redis = require('../config/redis');

// ─── Atomic counter ───────────────────────────────────────────────────────────

/**
 * Atomically increments a Redis counter for rate limiting.
 *
 * Window semantics (fixed window):
 * - INCR is atomic: no race conditions across horizontally scaled instances.
 * - TTL is set ONLY when the key is first created (count === 1).
 *   Subsequent increments inherit the existing TTL so the window does not reset.
 *
 * Callers are responsible for fail-open error handling.
 *
 * @param {string} key        Fully-namespaced Redis key (e.g. "rate:ip:1.2.3.4")
 * @param {number} windowSec  Window duration in seconds
 * @returns {Promise<number>} Current request count within the window
 */
async function increment(key, windowSec) {
  const count = await redis.incr(key);

  if (count === 1) {
    // First request in this window — set the expiry.
    // Subsequent increments inherit this TTL; the window never resets mid-flight.
    await redis.expire(key, windowSec);
  }

  return count;
}

/**
 * Returns the remaining TTL (in seconds) for a key.
 * Used to populate the Retry-After response header when a limit is exceeded.
 *
 * Falls back to windowSec if the key has no TTL or has already expired,
 * which should never happen in normal operation but guards against edge cases.
 *
 * Only called on the 429 path — not on every request.
 *
 * @param {string} key
 * @param {number} windowSec  Fallback if TTL is unavailable
 * @returns {Promise<number>} Seconds until the window resets
 */
async function getRemainingTtl(key, windowSec) {
  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : windowSec;
}

module.exports = { increment, getRemainingTtl };
