'use strict';

const pool                   = require('../../config/db');
const paymentsService        = require('../payments/payments.service');

// ============================================================
// HELPERS
// ============================================================

/**
 * Resolves organizationId for a paymentId via payment_links.
 * Ensures the confirm call is anchored to the secure link flow —
 * a bare paymentId that was never linked cannot be confirmed here.
 *
 * Returns null if no matching link exists.
 */
async function resolveOrgFromPaymentLink(paymentId) {
  const { rows } = await pool.query(
    `SELECT organization_id
     FROM   payment_links
     WHERE  payment_id = $1
     LIMIT  1`,
    [paymentId]
  );
  return rows.length > 0 ? rows[0].organization_id : null;
}

// ============================================================
// CONTROLLER
// ============================================================

async function confirmPaymentCheckout(req, res) {
  const { paymentId, gatewayPaymentId } = req.body;

  if (!paymentId || !gatewayPaymentId) {
    return res.status(400).json({
      success: false,
      message: 'paymentId and gatewayPaymentId are required',
    });
  }

  // ── Step 1: Resolve organization via payment_links ────────
  // Prevents confirming payments that never went through the link flow.
  let organizationId;
  try {
    organizationId = await resolveOrgFromPaymentLink(paymentId);
  } catch (err) {
    console.error('[PaymentCheckoutPublic] DB error resolving org:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  if (!organizationId) {
    return res.status(404).json({
      success: false,
      message: 'Payment not found',
    });
  }

  // ── Step 2: Fetch payment and validate it exists ──────────
  let payment;
  try {
    payment = await paymentsService.getPaymentById({ organizationId, id: paymentId });
  } catch (err) {
    console.error('[PaymentCheckoutPublic] DB error fetching payment:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  if (!payment) {
    return res.status(404).json({
      success: false,
      message: 'Payment not found',
    });
  }

  // ── Step 3: Validate payment is still PENDING ─────────────
  if (payment.status !== 'PENDING') {
    const message =
      payment.status === 'SUCCESS'
        ? 'This payment has already been completed'
        : 'This payment cannot be processed';

    return res.status(422).json({ success: false, message });
  }

  // ── Step 4: Mark payment SUCCESS ─────────────────────────
  try {
    await paymentsService.updatePaymentStatus({
      organizationId,
      id:               paymentId,
      status:           'SUCCESS',
      gatewayPaymentId,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('[PaymentCheckoutPublic] Failed to update payment status:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  return res.status(200).json({
    success: true,
    message: 'Payment confirmed successfully',
    data: {
      paymentId,
      status: 'SUCCESS',
    },
  });
}

module.exports = { confirmPaymentCheckout };
