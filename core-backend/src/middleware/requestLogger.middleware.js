'use strict';

const logger = require('../utils/logger');

// Headers that must never appear in logs
const REDACT_HEADERS = new Set(['authorization', 'cookie', 'x-api-key', 'x-auth-token']);

/**
 * requestLogger middleware
 *
 * Logs one structured JSON line per completed HTTP request containing:
 *   requestId, organizationId, method, path, statusCode, latencyMs
 *
 * Timing starts before body parsing and route dispatch; the log entry
 * is written on the "finish" event (headers + body fully flushed).
 *
 * Sensitive headers (Authorization, Cookie, etc.) are never logged.
 * Request/response bodies are intentionally excluded.
 */
function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    const latencyMs      = Date.now() - startedAt;
    const organizationId = req.user ? (req.user.organizationId || undefined) : undefined;

    logger.info('HTTP request', {
      requestId:      req.requestId,
      organizationId,
      method:         req.method,
      path:           req.path,
      statusCode:     res.statusCode,
      latencyMs,
    });
  });

  next();
}

module.exports = requestLogger;
