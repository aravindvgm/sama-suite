'use strict';

const { getParentPaymentLedger } = require('./parentPayments.service');

async function getPaymentLedger(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const data = await getParentPaymentLedger({ organizationId, studentId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getPaymentLedger error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getPaymentLedger };
