const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');

/**
 * Create Redis Store if Redis is available
 */
const createRedisStore = (prefix) => {
  if (!redis) {
    console.log(`⚠️ Redis disabled → using memory store for ${prefix}`);
    return undefined;
  }

  return new RedisStore({
    sendCommand: (...args) => redis.call(...args),
    prefix,
  });
};

/**
 * Standard 429 response
 */
const rateLimitResponse = {
  success: false,
  message: 'Too many requests, please try again later.',
};

/**
 * LOGIN - IP Layer (20 per 15 mins)
 */
const loginIpLimiter = rateLimit({
  store: createRedisStore('login-ip:'),
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

/**
 * LOGIN - Email Layer (100 per 15 mins per email)
 */
const loginEmailLimiter = rateLimit({
  store: createRedisStore('login-email:'),
  windowMs: 15 * 60 * 1000,
  max: 100,
  keyGenerator: (req) =>
    `email:${(req.body?.email || 'unknown').toLowerCase()}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

/**
 * AUTH ROUTES LIMITER (50 per 10 mins per IP)
 */
const authLimiter = rateLimit({
  store: createRedisStore('auth:'),
  windowMs: 10 * 60 * 1000,
  max: 50,
  keyGenerator: (req) => ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

/**
 * GLOBAL API LIMITER (500 per min per IP)
 */
const apiLimiter = rateLimit({
  store: createRedisStore('api-ip:'),
  windowMs: 60 * 1000,
  max: 500,
  keyGenerator: (req) => ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitResponse,
});

module.exports = {
  loginIpLimiter,
  loginEmailLimiter,
  authLimiter,
  apiLimiter,
};