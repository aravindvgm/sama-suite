'use strict';

const fs   = require('fs');
const path = require('path');
const pool = require('../../config/db');
const { generatePaymentReceiptPdf } = require('./paymentReceipt.service');

const DOCUMENTS_DIR = path.resolve(__dirname, '../../../uploads/documents');

// ============================================================
// VALIDATE PAYMENT
// Returns the payment row. Throws 404 or 422 with statusCode.
// ============================================================

async function assertPaymentDownloadable({ organizationId, paymentId }) {
  const { rows } = await pool.query(
    `SELECT id, status
     FROM   payments
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [paymentId, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }

  if (rows[0].status !== 'SUCCESS') {
    const err = new Error('Receipt is only available for successful payments');
    err.statusCode = 404;
    throw err;
  }
}

// ============================================================
// FIND EXISTING RECEIPT ON DISK
// Receipts are named: receipt_<paymentId>_<timestamp>.pdf
// Return the most recently generated one if it exists.
// ============================================================

function findExistingReceipt(paymentId) {
  try {
    if (!fs.existsSync(DOCUMENTS_DIR)) return null;

    const files = fs.readdirSync(DOCUMENTS_DIR).filter(
      (f) => f.startsWith(`receipt_${paymentId}_`) && f.endsWith('.pdf')
    );

    if (files.length === 0) return null;

    // Return most recently modified file
    const sorted = files
      .map((f) => ({ file: f, mtime: fs.statSync(path.join(DOCUMENTS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    return path.join(DOCUMENTS_DIR, sorted[0].file);
  } catch {
    return null;
  }
}

// ============================================================
// RESOLVE RECEIPT PATH
// Returns existing file path or generates a fresh one.
// ============================================================

async function resolveReceiptPath({ organizationId, paymentId }) {
  await assertPaymentDownloadable({ organizationId, paymentId });

  const existing = findExistingReceipt(paymentId);
  if (existing) return existing;

  // Generate fresh receipt — generatePaymentReceiptPdf throws on failure
  const { filePath } = await generatePaymentReceiptPdf({ organizationId, paymentId });
  return filePath;
}

module.exports = { resolveReceiptPath };
