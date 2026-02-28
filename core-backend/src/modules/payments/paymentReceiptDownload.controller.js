'use strict';

const fs   = require('fs');
const path = require('path');
const { resolveReceiptPath } = require('./paymentReceiptDownload.service');

async function downloadPaymentReceipt(req, res) {
  const { organizationId } = req.user;
  const { paymentId }      = req.params;

  let filePath;
  try {
    filePath = await resolveReceiptPath({ organizationId, paymentId });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('downloadPaymentReceipt error:', err);
    return res.status(500).json({ success: false, message: 'Failed to generate receipt' });
  }

  // Confirm file is readable before streaming
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(500).json({ success: false, message: 'Receipt file could not be located' });
  }

  const filename = `receipt_${paymentId}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

  const stream = fs.createReadStream(filePath);

  stream.on('error', (err) => {
    console.error('Receipt stream error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to stream receipt' });
    }
  });

  stream.pipe(res);
}

module.exports = { downloadPaymentReceipt };
