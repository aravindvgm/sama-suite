'use strict';

const crypto                        = require('crypto');
const pool                          = require('../../config/db');
const paymentsService               = require('./payments.service');
const auditService                  = require('../../utils/auditService');
const { generatePaymentReceiptPdf } = require('./paymentReceipt.service');
const { sendWhatsAppMessage }       = require('../../utils/whatsapp.service');
const { insertGatewayEvent }        = require('./gatewayEvent.service');
const logger                        = require('../../utils/logger');

// ============================================================
// REPLAY WINDOW
// Events older than this are rejected as potential replays.
// 15 minutes accommodates legitimate gateway retries and
// network delays while closing the replay attack window.
// ============================================================

const REPLAY_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// ============================================================
// SIGNATURE HEADER NAMES PER GATEWAY
// ============================================================

const GATEWAY_SIG_HEADERS = {
  razorpay: 'x-razorpay-signature',
  phonepe:  'x-verify',
  stripe:   'stripe-signature',
  generic:  'x-webhook-signature',
};

// ============================================================
// GATEWAY STATUS → INTERNAL STATUS MAP
// ============================================================

const GATEWAY_STATUS_MAP = {
  // Razorpay event types
  'payment.captured':              'SUCCESS',
  'payment.failed':                'FAILED',

  // PhonePe event codes
  'PAYMENT_SUCCESS':               'SUCCESS',
  'PAYMENT_ERROR':                 'FAILED',
  'PAYMENT_DECLINED':              'FAILED',

  // Stripe event types
  'payment_intent.succeeded':      'SUCCESS',
  'payment_intent.payment_failed': 'FAILED',
  'charge.succeeded':              'SUCCESS',
  'charge.failed':                 'FAILED',

  // Generic / normalised values
  'SUCCESS':                       'SUCCESS',
  'PAID':                          'SUCCESS',
  'FAILED':                        'FAILED',
  'FAILURE':                       'FAILED',
  'DECLINED':                      'FAILED',
};

function normalizeStatus(gatewayStatus) {
  if (!gatewayStatus) return null;
  return GATEWAY_STATUS_MAP[gatewayStatus] || GATEWAY_STATUS_MAP[gatewayStatus.toUpperCase()] || null;
}

// ============================================================
// SIGNATURE VALIDATION
// Supports:
//   Razorpay  — HMAC-SHA256( orderId + "|" + paymentId, secret )
//   PhonePe   — SHA256( base64Payload + "/pg/v1/pay" + secret ) + "###1"
//   Stripe    — Stripe's tiered timestamp+v1 scheme (simplified)
//   Generic   — HMAC-SHA256( rawBody, secret )
// Falls back to generic HMAC when gateway is unknown.
// ============================================================

function validateSignature({ gateway, rawBody, headers, orderId, paymentId }) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('Webhook: PAYMENT_WEBHOOK_SECRET is not set');
    return false;
  }

  const gw = (gateway || 'generic').toLowerCase();

  try {
    if (gw === 'razorpay') {
      const received = headers[GATEWAY_SIG_HEADERS.razorpay];
      if (!received) return false;
      const expected = crypto
        .createHmac('sha256', secret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
      return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    }

    if (gw === 'stripe') {
      // Stripe sends: "t=timestamp,v1=sig1,v1=sig2..."
      const received = headers[GATEWAY_SIG_HEADERS.stripe] || '';
      const parts    = Object.fromEntries(
        received.split(',').map((p) => p.split('='))
      );
      const timestamp = parts.t;
      const v1Sig     = parts.v1;
      if (!timestamp || !v1Sig) return false;
      const payload  = `${timestamp}.${rawBody.toString('utf8')}`;
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(v1Sig), Buffer.from(expected));
    }

    // Generic / PhonePe / unknown — HMAC-SHA256 of raw body
    const sigHeader = GATEWAY_SIG_HEADERS[gw] || GATEWAY_SIG_HEADERS.generic;
    const received  = headers[sigHeader] || headers[GATEWAY_SIG_HEADERS.generic];
    if (!received) return false;
    const expected  = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(received.toLowerCase()),
      Buffer.from(expected.toLowerCase())
    );
  } catch {
    return false;
  }
}

// ============================================================
// TIMESTAMP EXTRACTION
// Returns event timestamp in milliseconds, or null if absent.
// Stripe embeds it in the signature header (t=<unix_seconds>).
// Most other gateways use event.created_at (Unix seconds).
// ============================================================

function extractEventTimestamp(gateway, event, headers) {
  if (gateway === 'stripe') {
    const sigHeader = headers[GATEWAY_SIG_HEADERS.stripe] || '';
    const parts     = Object.fromEntries(
      sigHeader.split(',').map((p) => p.split('='))
    );
    const ts = parseInt(parts.t, 10);
    if (!isNaN(ts)) return ts * 1000;
  }

  const raw = event.created_at ?? event.timestamp;
  if (raw != null) {
    const ts = parseInt(raw, 10);
    if (!isNaN(ts)) {
      // Handle both Unix seconds (< 1e12) and milliseconds (>= 1e12)
      return ts > 1e12 ? ts : ts * 1000;
    }
  }

  return null; // gateway did not send a timestamp — skip check
}

// ============================================================
// GATEWAY EVENT ID EXTRACTION
// Prefers the gateway's own event-level ID (Razorpay evt_xxx,
// Stripe evt_xxx) over the payment-level ID for idempotency.
// Falls back to a composite key when no dedicated event ID exists.
// ============================================================

function extractGatewayEventId(event, gatewayOrderId, gatewayPaymentId, gateway) {
  return (
    event.id        ||
    event.event_id  ||
    `${gateway}:${gatewayOrderId || ''}:${gatewayPaymentId || ''}`
  );
}

// ============================================================
// POST-SUCCESS: generate receipt PDF + send WhatsApp
// Fire-and-forget — must never throw or block the webhook response.
// ============================================================

async function resolveStudentContact(studentId, organizationId) {
  try {
    const { rows } = await pool.query(
      `SELECT father_mobile, mother_mobile, primary_contact
       FROM   students
       WHERE  id              = $1
         AND  organization_id = $2
         AND  deleted_at IS NULL`,
      [studentId, organizationId]
    );
    if (rows.length === 0) return null;
    const s       = rows[0];
    const primary = (s.primary_contact || 'FATHER').toUpperCase();
    if (primary === 'MOTHER' && s.mother_mobile) return s.mother_mobile;
    if (primary === 'FATHER' && s.father_mobile) return s.father_mobile;
    return s.father_mobile || s.mother_mobile || null;
  } catch {
    return null;
  }
}

function dispatchReceiptNotification({ organizationId, paymentId, studentId }) {
  // Deliberately not awaited — runs in background, errors are swallowed.
  (async () => {
    try {
      const { filePath } = await generatePaymentReceiptPdf({ organizationId, paymentId });
      logger.info('Webhook: receipt generated', { organizationId, paymentId, filePath });

      const contactNumber = await resolveStudentContact(studentId, organizationId);
      if (!contactNumber) {
        logger.warn('Webhook: no contact number for student — skipping WhatsApp', {
          organizationId,
          studentId,
          paymentId,
        });
        return;
      }

      await sendWhatsAppMessage(
        contactNumber,
        'Payment received successfully. Receipt attached.'
      );
      logger.info('Webhook: receipt WhatsApp sent', { organizationId, paymentId, contactNumber });
    } catch (err) {
      logger.error('Webhook: receipt/WhatsApp dispatch failed', {
        organizationId,
        paymentId,
        error: err.message,
      });
    }
  })();
}

// ============================================================
// PAYMENT LOOKUP BY gateway_order_id
// ============================================================

async function findPaymentByOrderId(gatewayOrderId) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, status, student_id, student_fee_id
     FROM   payments
     WHERE  gateway_order_id = $1
       AND  deleted_at IS NULL
     LIMIT  1`,
    [gatewayOrderId]
  );
  return rows[0] || null;
}

// ============================================================
// WEBHOOK HANDLER
//
// Processing order (CTO-approved):
//   1. Verify signature          → 401 on failure
//   2. Validate timestamp        → 400 if > 15 min stale
//   3. Locate payment by orderId → 404 if not found
//   4. Derive organizationId     → from DB record (never webhook body)
//   5. Insert gateway_events     → 200 immediately on duplicate (replay)
//   6. Check terminal state      → 200 (belt-and-suspenders guard)
//   7. Update payment status     → 500 on error
// ============================================================

async function handlePaymentWebhook(req, res) {
  const requestId = req.requestId;
  const rawBody   = req.rawBody; // attached by express.raw() via verify option
  const headers   = req.headers;

  let event = {};

  // ── Parse body ──────────────────────────────────────────────
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.warn('Webhook: failed to parse payload', { requestId });
    return res.status(400).json({ received: false, error: 'invalid_payload' });
  }

  const gateway          = (event.gateway || req.query.gateway || 'generic').toLowerCase();
  const gatewayOrderId   = event.gateway_order_id   || event.order_id   || event.data?.order_id;
  const gatewayPaymentId = event.gateway_payment_id || event.payment_id || event.data?.payment_id || event.id;
  const rawStatus        = event.status || event.event || event.event_type || event.code;
  const gatewayEventId   = extractGatewayEventId(event, gatewayOrderId, gatewayPaymentId, gateway);

  // ── Step 1: Verify signature ─────────────────────────────────
  const signatureValid = validateSignature({
    gateway,
    rawBody,
    headers,
    orderId:   gatewayOrderId,
    paymentId: gatewayPaymentId,
  });

  if (!signatureValid) {
    logger.warn('Webhook: invalid signature', {
      requestId,
      gateway,
      gatewayEventId,
      signature_invalid: true,
      replay_detected:   false,
    });
    return res.status(401).json({ received: false, error: 'invalid_signature' });
  }

  // ── Step 2: Validate timestamp ───────────────────────────────
  const eventTimestampMs = extractEventTimestamp(gateway, event, headers);
  if (eventTimestampMs !== null) {
    const ageMs = Date.now() - eventTimestampMs;
    if (ageMs > REPLAY_WINDOW_MS) {
      logger.warn('Webhook: stale event rejected', {
        requestId,
        gateway,
        gatewayEventId,
        ageMs,
        signature_invalid: false,
        replay_detected:   true,
      });
      return res.status(400).json({ received: false, error: 'stale_event' });
    }
  }

  // ── Normalize and gate on terminal statuses ──────────────────
  const internalStatus = normalizeStatus(rawStatus);
  if (!internalStatus || !['SUCCESS', 'FAILED'].includes(internalStatus)) {
    logger.info('Webhook: non-terminal or unrecognised status — no-op', {
      requestId,
      gateway,
      gatewayEventId,
      rawStatus,
    });
    return res.status(200).json({ received: true });
  }

  if (!gatewayOrderId) {
    logger.warn('Webhook: missing gateway_order_id', { requestId, gateway, gatewayEventId });
    return res.status(400).json({ received: false, error: 'missing_order_id' });
  }

  // ── Step 3: Locate payment record ───────────────────────────
  let payment = null;
  try {
    payment = await findPaymentByOrderId(gatewayOrderId);
  } catch (err) {
    logger.error('Webhook: DB error during payment lookup', {
      requestId,
      gateway,
      gatewayEventId,
      error: err.message,
    });
    return res.status(500).json({ received: false, error: 'internal_error' });
  }

  if (!payment) {
    logger.warn('Webhook: payment not found', {
      requestId,
      gateway,
      gatewayEventId,
    });
    // 404 without leaking tenant/order details in the body
    return res.status(404).json({ received: false, error: 'payment_not_found' });
  }

  // ── Step 4: Derive organizationId from DB (never from body) ──
  const organizationId = payment.organization_id;

  // ── Step 5: Insert idempotency record ───────────────────────
  let isNewEvent;
  try {
    isNewEvent = await insertGatewayEvent({
      gateway,
      gatewayEventId,
      organizationId,
      payload: event,
    });
  } catch (err) {
    logger.error('Webhook: gateway_events insert failed', {
      requestId,
      gateway,
      gatewayEventId,
      organizationId,
      error: err.message,
    });
    return res.status(500).json({ received: false, error: 'internal_error' });
  }

  if (!isNewEvent) {
    logger.info('Webhook: duplicate event — replay detected, skipping', {
      requestId,
      gateway,
      gatewayEventId,
      organizationId,
      signature_invalid: false,
      replay_detected:   true,
    });
    return res.status(200).json({ received: true, skipped: 'replay' });
  }

  // ── Step 6: Terminal-state guard (belt-and-suspenders) ───────
  if (['SUCCESS', 'FAILED'].includes(payment.status)) {
    logger.info('Webhook: payment already in terminal state — skipping', {
      requestId,
      gateway,
      gatewayEventId,
      organizationId,
      currentStatus:   payment.status,
      replay_detected: true,
    });
    return res.status(200).json({ received: true, skipped: 'already_terminal' });
  }

  // ── Step 7: Update payment status ───────────────────────────
  try {
    const updated = await paymentsService.updatePaymentStatus({
      organizationId,
      id:               payment.id,
      status:           internalStatus,
      gatewayPaymentId: gatewayPaymentId || null,
    });

    auditService.logAction({
      organizationId,
      actorType:  'SYSTEM',
      action:     'UPDATE',
      entityType: 'PAYMENT',
      entityId:   payment.id,
      requestId,
      meta: {
        source:             'WEBHOOK',
        gateway,
        gateway_event_id:   gatewayEventId,
        gateway_order_id:   gatewayOrderId,
        gateway_payment_id: gatewayPaymentId,
        raw_status:         rawStatus,
        mapped_status:      internalStatus,
      },
      ipAddress: req.ip,
    });

    logger.info('Webhook: payment status updated', {
      requestId,
      gateway,
      gatewayEventId,
      organizationId,
      paymentId:         payment.id,
      internalStatus,
      signature_invalid: false,
      replay_detected:   false,
    });

    // Fire-and-forget receipt generation + WhatsApp on SUCCESS only
    if (internalStatus === 'SUCCESS') {
      dispatchReceiptNotification({
        organizationId,
        paymentId: payment.id,
        studentId: updated.student_id,
      });
    }
  } catch (err) {
    logger.error('Webhook: failed to update payment status', {
      requestId,
      gateway,
      gatewayEventId,
      organizationId,
      paymentId: payment.id,
      error:     err.message,
    });
    return res.status(500).json({ received: false, error: 'internal_error' });
  }

  return res.status(200).json({ received: true });
}

module.exports = { handlePaymentWebhook };
