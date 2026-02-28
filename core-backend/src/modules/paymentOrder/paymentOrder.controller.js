'use strict';

const paymentOrderService = require('./paymentOrder.service');
const auditService        = require('../../utils/auditService');

async function createPaymentOrder(req, res) {
  const { organizationId, userId }            = req.user;
  const { studentFeeId, amount, paymentMethod } = req.body;

  try {
    const order = await paymentOrderService.createPaymentOrder({
      organizationId,
      userId,
      studentFeeId,
      amount,
      paymentMethod,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'PAYMENT_ORDER',
      entityId:   order.paymentId,
      meta: {
        gateway_order_id: order.gatewayOrderId,
        student_fee_id:   studentFeeId,
        amount:           order.amount,
        gateway:          order.gateway,
        payment_method:   paymentMethod,
      },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, data: order });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('createPaymentOrder error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { createPaymentOrder };
