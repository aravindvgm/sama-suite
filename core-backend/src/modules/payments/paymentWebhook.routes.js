'use strict';

const express    = require('express');
const router     = express.Router();
const controller = require('./paymentWebhook.controller');

/**
 * Webhook route — NO JWT authentication.
 *
 * Raw body capture:
 *   express.raw() is applied ONLY to this route so the signature
 *   validator receives the original bytes before any JSON parsing.
 *   The parsed buffer is attached to req.rawBody.
 *
 * IMPORTANT — mount this router in app.js BEFORE express.json():
 *
 *   const webhookRoutes = require('./modules/payments/paymentWebhook.routes');
 *   app.use('/api/payments', webhookRoutes);   // must precede express.json()
 */

router.post(
  '/webhook',
  express.raw({ type: '*/*' }),   // capture raw bytes; sets req.body = Buffer
  (req, _res, next) => {
    // Expose the raw buffer as req.rawBody for the controller
    req.rawBody = req.body;
    // Re-parse as JSON so downstream code can use req.body normally if needed
    try {
      if (Buffer.isBuffer(req.body) && req.body.length > 0) {
        req.body = JSON.parse(req.body.toString('utf8'));
      }
    } catch {
      req.body = {};
    }
    next();
  },
  controller.handlePaymentWebhook
);

module.exports = router;
