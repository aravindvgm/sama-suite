'use strict';

const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  // ── Structured internal log (stack included for debugging) ──
  logger.error(err.message || 'Internal Server Error', {
    requestId:      req.requestId,
    organizationId: req.user ? (req.user.organizationId || undefined) : undefined,
    method:         req.method,
    path:           req.path,
    statusCode:     err.status || 500,
    stack:          err.stack,           // internal only — never sent to client
  });

  // ── Client response (unchanged behaviour) ───────────────────
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    stack:   process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}

module.exports = errorHandler;
