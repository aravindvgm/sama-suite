'use strict';

const { reconcilePayment } = require('./paymentReconcile.service');
const auditService         = require('../../utils/auditService');

async function reconcilePaymentByOrderId(req, res) {
  const { organizationId, userId } = req.user;
  const { gatewayOrderId }         = req.params;

  let result;
  try {
    result = await reconcilePayment({ organizationId, gatewayOrderId });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('reconcilePayment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  // Audit regardless of whether status actually changed
  auditService.log({
    organizationId,
    userId,
    action:     'RECONCILE',
    entityType: 'PAYMENT',
    entityId:   result.paymentId,
    meta: {
      gateway_order_id:   gatewayOrderId,
      gateway_payment_id: result.gatewayPaymentId || null,
      previous_status:    result.previousStatus   || result.currentStatus,
      current_status:     result.currentStatus,
      reconciled:         result.reconciled,
      reason:             result.reason           || null,
    },
    ipAddress: req.ip,
  });

  return res.status(200).json({ success: true, data: result });
}

module.exports = { reconcilePaymentByOrderId };
