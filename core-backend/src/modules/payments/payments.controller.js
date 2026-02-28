'use strict';

const paymentsService = require('./payments.service');
const auditService    = require('../../utils/auditService');

// ============================================================
// CREATE PAYMENT
// ============================================================

async function createPayment(req, res) {
  const { organizationId, userId } = req.user;
  const {
    studentFeeId,
    studentId,
    enrollmentId,
    amount,
    paymentMethod,
    gateway,
    gatewayOrderId,
    gatewayPaymentId,
  } = req.body;

  try {
    const record = await paymentsService.createPayment({
      organizationId,
      userId,
      studentFeeId,
      studentId,
      enrollmentId,
      amount,
      paymentMethod,
      gateway,
      gatewayOrderId,
      gatewayPaymentId,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'PAYMENT',
      entityId:   record.id,
      meta: {
        student_fee_id:   record.student_fee_id,
        student_id:       record.student_id,
        amount:           record.amount,
        payment_method:   record.payment_method,
        gateway:          record.gateway,
        gateway_order_id: record.gateway_order_id,
        status:           record.status,
      },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('createPayment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE PAYMENT STATUS
// ============================================================

async function updatePaymentStatus(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;
  const { status, gatewayPaymentId } = req.body;

  try {
    const result = await paymentsService.updatePaymentStatus({
      organizationId,
      id,
      status,
      gatewayPaymentId,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'UPDATE',
      entityType: 'PAYMENT',
      entityId:   result.id,
      meta: {
        status:             result.status,
        gateway_payment_id: result.gateway_payment_id,
        paid_at:            result.paid_at,
        fee_balance:        result.feeBalance,
      },
      ipAddress: req.ip,
    });

    // Strip internal feeBalance from the client response or expose it clearly
    const { feeBalance, ...payment } = result;

    return res.json({
      success: true,
      data:    payment,
      ...(feeBalance && { feeStatus: feeBalance }),
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('updatePaymentStatus error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET STUDENT PAYMENTS
// ============================================================

async function getStudentPayments(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const rows = await paymentsService.getStudentPayments({ organizationId, studentId });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getStudentPayments error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  createPayment,
  updatePaymentStatus,
  getStudentPayments,
};
