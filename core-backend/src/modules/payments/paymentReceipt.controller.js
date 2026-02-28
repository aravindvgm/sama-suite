'use strict';

const paymentReceiptService = require('./paymentReceipt.service');
const auditService          = require('../../utils/auditService');

async function generatePaymentReceipt(req, res) {
  const { organizationId, userId } = req.user;
  const { paymentId }              = req.params;

  try {
    const result = await paymentReceiptService.generatePaymentReceiptPdf({ organizationId, paymentId });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'PAYMENT_RECEIPT',
      entityId:   paymentId,
      meta:       { receipt_number: result.receiptNumber, generated_at: new Date().toISOString() },
      ipAddress:  req.ip,
    });

    return res.download(result.filePath, `receipt_${result.receiptNumber}.pdf`, (err) => {
      if (err) {
        console.error('generatePaymentReceipt download error:', err);
        if (!res.headersSent) {
          return res.status(500).json({ success: false, message: 'Failed to send receipt file' });
        }
      }
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('generatePaymentReceipt error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { generatePaymentReceipt };
