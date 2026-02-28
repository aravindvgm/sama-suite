'use strict';

const pool            = require('../../config/db');
const paymentsService = require('./payments.service');

// ============================================================
// LOOKUP BY gateway_order_id
// ============================================================

async function findPaymentByGatewayOrderId({ gatewayOrderId, organizationId }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, status, gateway_order_id, gateway_payment_id, student_id
     FROM   payments
     WHERE  gateway_order_id = $1
       AND  organization_id  = $2
       AND  deleted_at IS NULL
     LIMIT  1`,
    [gatewayOrderId, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error(`No payment found for gateway_order_id: ${gatewayOrderId}`);
    err.statusCode = 404;
    throw err;
  }

  return rows[0];
}

// ============================================================
// GATEWAY VERIFICATION SIMULATION
// Real implementation: call Razorpay/Stripe SDK to fetch order
// status and compare. Here:
//   gateway_payment_id present  → payment was captured → SUCCESS
//   gateway_payment_id absent   → payment was never captured → FAILED
// ============================================================

function simulateGatewayVerification(payment) {
  const captured = Boolean(payment.gateway_payment_id);
  return {
    verifiedStatus:    captured ? 'SUCCESS' : 'FAILED',
    gatewayPaymentId:  payment.gateway_payment_id || null,
  };
}

// ============================================================
// RECONCILE
// ============================================================

async function reconcilePayment({ organizationId, gatewayOrderId }) {
  // ── Step 1: Find payment ──────────────────────────────────
  const payment = await findPaymentByGatewayOrderId({ gatewayOrderId, organizationId });

  // ── Step 2: Already terminal — return safely ──────────────
  if (payment.status === 'SUCCESS') {
    return {
      reconciled:    false,
      reason:        'already_success',
      paymentId:     payment.id,
      currentStatus: 'SUCCESS',
    };
  }

  // ── Step 3: Simulate gateway verification ─────────────────
  const { verifiedStatus, gatewayPaymentId } = simulateGatewayVerification(payment);

  // ── Step 4: Update payment status ─────────────────────────
  const updated = await paymentsService.updatePaymentStatus({
    organizationId,
    id:               payment.id,
    status:           verifiedStatus,
    gatewayPaymentId: gatewayPaymentId,
  });

  return {
    reconciled:    true,
    paymentId:     payment.id,
    previousStatus: payment.status,
    currentStatus:  verifiedStatus,
    gatewayOrderId,
    gatewayPaymentId,
    feeBalance:    updated.feeBalance || null,
  };
}

module.exports = { reconcilePayment };
