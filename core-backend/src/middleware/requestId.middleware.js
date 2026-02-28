'use strict';

const crypto = require('crypto');

/**
 * requestId middleware
 *
 * Generates a unique trace ID for every incoming request.
 * Accepts "x-request-id" from upstream gateways for end-to-end tracing.
 * Falls back to crypto.randomUUID() when no ID is provided.
 *
 * Attaches to:
 *   req.requestId          — available to all downstream middleware and handlers
 *   res.locals.requestId   — available to view engines / response helpers
 *   X-Request-ID header    — echoed in the response for client-side correlation
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomUUID();

  req.requestId        = id;
  res.locals.requestId = id;
  res.setHeader('X-Request-ID', id);

  next();
}

module.exports = requestId;
