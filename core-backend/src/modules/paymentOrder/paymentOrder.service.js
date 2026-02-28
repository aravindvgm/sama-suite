'use strict';

const { v4: uuidv4 }    = require('uuid');
const pool              = require('../../config/db');
const paymentsService   = require('../payments/payments.service');

// ============================================================
// HELPERS
// ============================================================

async function fetchFeeWithBalance(client, { studentFeeId, organizationId }) {
  // Fee record
  const { rows: feeRows } = await client.query(
    `SELECT id, student_id, enrollment_id, amount, status
     FROM   student_fees
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentFeeId, organizationId]
  );

  if (feeRows.length === 0) {
    const err = new Error('Student fee record not found in this organization');
    err.statusCode = 404;
    throw err;
  }

  const fee = feeRows[0];

  if (fee.status === 'PAID') {
    const err = new Error('This fee has already been fully paid');
    err.statusCode = 422;
    throw err;
  }

  // Compute remaining balance
  const { rows: sumRows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
     FROM   payments
     WHERE  student_fee_id  = $1
       AND  organization_id = $2
       AND  status          = 'SUCCESS'
       AND  deleted_at IS NULL`,
    [studentFeeId, organizationId]
  );

  const feeAmount    = parseFloat(fee.amount);
  const totalPaid    = parseFloat(sumRows[0].total_paid);
  const balance      = parseFloat((feeAmount - totalPaid).toFixed(2));

  return { fee, feeAmount, totalPaid, balance };
}

// ============================================================
// GATEWAY ORDER SIMULATION
// Replace this block with live Razorpay SDK call:
//   const Razorpay = require('razorpay');
//   const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID,
//                                   key_secret: process.env.RAZORPAY_KEY_SECRET });
//   const order = await razorpay.orders.create({ amount: amountInPaise,
//                                                currency: 'INR',
//                                                receipt: receiptId });
//   return { gatewayOrderId: order.id };
// ============================================================

async function createGatewayOrder({ amount, receiptId }) {
  // Simulated — generates a deterministic placeholder order ID
  const gatewayOrderId = `order_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
  return { gatewayOrderId };
}

// ============================================================
// CREATE PAYMENT ORDER
// ============================================================

async function createPaymentOrder({ organizationId, userId, studentFeeId, amount, paymentMethod }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { fee, balance } = await fetchFeeWithBalance(client, { studentFeeId, organizationId });

    // Amount validation
    const requestedAmount = parseFloat(amount);
    if (isNaN(requestedAmount) || requestedAmount <= 0) {
      const err = new Error('Amount must be a positive number');
      err.statusCode = 422;
      throw err;
    }
    if (requestedAmount > balance) {
      const err = new Error(
        `Amount ₹${requestedAmount} exceeds remaining balance ₹${balance}`
      );
      err.statusCode = 422;
      throw err;
    }

    // Create gateway order (simulated / swap with live SDK)
    const receiptId = `rcpt_${studentFeeId.slice(0, 8)}_${Date.now()}`;
    const { gatewayOrderId } = await createGatewayOrder({
      amount:    requestedAmount,
      receiptId,
    });

    await client.query('COMMIT');

    // Create PENDING payment record via existing service
    // (uses its own transaction internally)
    const payment = await paymentsService.createPayment({
      organizationId,
      userId,
      studentFeeId,
      studentId:        fee.student_id,
      enrollmentId:     fee.enrollment_id,
      amount:           requestedAmount,
      paymentMethod:    paymentMethod || 'UPI',
      gateway:          'RAZORPAY',
      gatewayOrderId,
      gatewayPaymentId: null,
    });

    return {
      paymentId:      payment.id,
      gatewayOrderId,
      amount:         requestedAmount,
      currency:       'INR',
      gateway:        'RAZORPAY',
      studentFeeId,
      balance,
      status:         'PENDING',
    };
  } catch (err) {
    // Only roll back if transaction still open (createPayment handles its own)
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createPaymentOrder };
