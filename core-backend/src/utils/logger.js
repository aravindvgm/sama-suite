'use strict';

/**
 * Structured JSON logger
 *
 * Emits one JSON line per log call to stdout so that log aggregators
 * (Datadog, CloudWatch, Loki, etc.) can parse fields without regex.
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('HTTP',  { requestId, method, path, statusCode, latencyMs });
 *   logger.error('Unhandled exception', { requestId, error: err.message });
 *
 * No external dependencies — plain console.log writes to stdout.
 */

function log(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  // Use process.stdout to bypass any console monkey-patching by test runners
  console.log(JSON.stringify(entry));
}

const logger = {
  info:  (message, context) => log('info',  message, context),
  warn:  (message, context) => log('warn',  message, context),
  error: (message, context) => log('error', message, context),
};

module.exports = logger;
