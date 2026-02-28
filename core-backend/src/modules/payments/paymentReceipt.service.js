'use strict';

const pool            = require('../../config/db');
const { generatePdf } = require('../../utils/pdf.service');

// ============================================================
// RECEIPT NUMBER
// RCPT-[YEAR]-[first 6 chars of payment UUID uppercased]
// ============================================================

function buildReceiptNumber(paymentId) {
  const year      = new Date().getFullYear();
  const shortUuid = paymentId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `RCPT-${year}-${shortUuid}`;
}

// ============================================================
// DATA FETCHER
// ============================================================

async function fetchReceiptData({ organizationId, paymentId }) {
  // Payment + student_fee + fee_structure in one query
  const { rows: paymentRows } = await pool.query(
    `SELECT
       p.id                  AS payment_id,
       p.status              AS payment_status,
       p.amount              AS paid_amount,
       p.payment_method,
       p.gateway,
       p.gateway_payment_id,
       p.paid_at,
       p.student_id,
       p.enrollment_id,
       p.student_fee_id,
       sf.amount             AS fee_amount,
       fs.fee_name
     FROM   payments       p
     JOIN   student_fees   sf ON sf.id = p.student_fee_id   AND sf.deleted_at IS NULL
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     WHERE  p.id              = $1
       AND  p.organization_id = $2
       AND  p.deleted_at IS NULL`,
    [paymentId, organizationId]
  );

  if (paymentRows.length === 0) {
    // 403 rather than 404 — prevents callers from enumerating whether a
    // payment exists in a different organisation.
    const err = new Error('Invalid resource for this organization');
    err.statusCode = 403;
    throw err;
  }

  const payment = paymentRows[0];

  if (payment.payment_status !== 'SUCCESS') {
    const err = new Error('Receipt available only for successful payments');
    err.statusCode = 422;
    throw err;
  }

  // Student
  const { rows: studentRows } = await pool.query(
    `SELECT first_name, last_name
     FROM   students
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [payment.student_id, organizationId]
  );

  // Enrollment + class + section
  const { rows: enrollmentRows } = await pool.query(
    `SELECT
       se.academic_year,
       c.name  AS class_name,
       s.name  AS section_name
     FROM   student_enrollments se
     JOIN   classes  c  ON c.id  = se.class_id    AND c.deleted_at  IS NULL
     LEFT   JOIN sections s ON s.id = se.section_id AND s.deleted_at IS NULL
     WHERE  se.id              = $1
       AND  se.organization_id = $2
       AND  se.deleted_at IS NULL`,
    [payment.enrollment_id, organizationId]
  );

  // Total SUCCESS payments for this fee (balance calculation)
  const { rows: sumRows } = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
     FROM   payments
     WHERE  student_fee_id  = $1
       AND  organization_id = $2
       AND  status          = 'SUCCESS'
       AND  deleted_at IS NULL`,
    [payment.student_fee_id, organizationId]
  );

  // Organization branding
  const { rows: orgRows } = await pool.query(
    `SELECT name, logo_path, signature_path, stamp_path
     FROM   organizations
     WHERE  id = $1`,
    [organizationId]
  );

  const student    = studentRows[0]    || {};
  const enrollment = enrollmentRows[0] || {};
  const org        = orgRows[0]        || {};
  const totalPaid  = parseFloat(sumRows[0].total_paid);
  const feeAmount  = parseFloat(payment.fee_amount);
  const balance    = Math.max(0, feeAmount - totalPaid);

  return { payment, student, enrollment, org, totalPaid, feeAmount, balance };
}

// ============================================================
// HTML TEMPLATE
// ============================================================

function formatDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatCurrency(val) {
  return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReceiptHtml({ receiptNumber, payment, student, enrollment, org, totalPaid, feeAmount, balance, issuedDate }) {
  const studentName  = `${student.first_name || ''} ${student.last_name || ''}`.trim() || '—';
  const orgName      = org.name || 'Institution';

  return `
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .receipt { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; padding: 0 4px 8px; }

    /* ── Title bar ── */
    .receipt-title-bar {
      text-align: center;
      padding: 16px 0 12px;
      border-bottom: 2px solid #1a3c6e;
      margin-bottom: 18px;
    }
    .receipt-title-bar h2 {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #1a3c6e;
    }
    .receipt-title-bar .org-name { font-size: 13px; color: #555; margin-top: 4px; }

    /* ── Meta row (receipt no + date) ── */
    .meta-row {
      display: flex;
      justify-content: space-between;
      background: #f0f4fb;
      border: 1px solid #d0daea;
      border-radius: 6px;
      padding: 10px 16px;
      margin-bottom: 18px;
      font-size: 12px;
    }
    .meta-row .label { color: #666; }
    .meta-row .value { font-weight: 700; color: #1a3c6e; font-size: 13px; }

    /* ── Section heading ── */
    .section-heading {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #1a3c6e;
      border-left: 3px solid #1a3c6e;
      padding-left: 8px;
      margin: 14px 0 8px;
    }

    /* ── Student card ── */
    .student-card {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 16px;
      background: #fafbfd;
      border: 1px solid #e4eaf5;
      border-radius: 6px;
      padding: 12px 16px;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .student-card .field-label { color: #888; font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; }
    .student-card .field-value { font-weight: 600; color: #222; margin-top: 1px; }

    /* ── Tables ── */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .data-table thead tr { background: #1a3c6e; color: #fff; }
    .data-table thead th { padding: 8px 12px; text-align: left; font-weight: 600; }
    .data-table tbody tr:nth-child(even) { background: #f7f9fc; }
    .data-table td { padding: 8px 12px; border-bottom: 1px solid #e8edf5; }
    .data-table .num { text-align: right; }

    /* ── Balance summary ── */
    .balance-summary {
      margin-top: 14px;
      border-top: 2px solid #1a3c6e;
      padding-top: 10px;
    }
    .balance-row {
      display: flex;
      justify-content: flex-end;
      gap: 32px;
      font-size: 12px;
      padding: 3px 12px;
    }
    .balance-row .bal-label { color: #555; min-width: 140px; text-align: right; }
    .balance-row .bal-value { font-weight: 600; min-width: 90px; text-align: right; }
    .balance-row.highlight .bal-label,
    .balance-row.highlight .bal-value { font-size: 14px; color: #1a3c6e; font-weight: 700; }
    .balance-row.balance-due .bal-value { color: #c62828; }
    .balance-row.balance-clear .bal-value { color: #2e7d32; }

    .issued-line { text-align: right; font-size: 10px; color: #aaa; margin-top: 12px; }
  </style>

  <div class="receipt">

    <!-- Title -->
    <div class="receipt-title-bar">
      <h2>Payment Receipt</h2>
      <div class="org-name">${orgName}</div>
    </div>

    <!-- Receipt No + Date -->
    <div class="meta-row">
      <div>
        <div class="label">Receipt Number</div>
        <div class="value">${receiptNumber}</div>
      </div>
      <div style="text-align:right">
        <div class="label">Date of Issue</div>
        <div class="value">${issuedDate}</div>
      </div>
    </div>

    <!-- Student Details -->
    <div class="section-heading">Student Details</div>
    <div class="student-card">
      <div>
        <div class="field-label">Student Name</div>
        <div class="field-value">${studentName}</div>
      </div>
      <div>
        <div class="field-label">Academic Year</div>
        <div class="field-value">${enrollment.academic_year || '—'}</div>
      </div>
      <div>
        <div class="field-label">Class</div>
        <div class="field-value">${enrollment.class_name || '—'}</div>
      </div>
      <div>
        <div class="field-label">Section</div>
        <div class="field-value">${enrollment.section_name || '—'}</div>
      </div>
    </div>

    <!-- Fee Details -->
    <div class="section-heading">Fee Details</div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Fee Name</th>
          <th class="num">Fee Amount (₹)</th>
          <th class="num">Total Paid (₹)</th>
          <th class="num">Balance (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${payment.fee_name}</td>
          <td class="num">${formatCurrency(feeAmount)}</td>
          <td class="num">${formatCurrency(totalPaid)}</td>
          <td class="num" style="color:${balance > 0 ? '#c62828' : '#2e7d32'};font-weight:700">
            ${formatCurrency(balance)}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Payment Information -->
    <div class="section-heading">Payment Information</div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Amount Paid (₹)</th>
          <th>Method</th>
          <th>Gateway</th>
          <th>Transaction ID</th>
          <th>Paid At</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="font-weight:700;color:#2e7d32">₹ ${formatCurrency(payment.paid_amount)}</td>
          <td>${payment.payment_method || '—'}</td>
          <td>${payment.gateway || '—'}</td>
          <td style="font-size:11px;color:#555">${payment.gateway_payment_id || '—'}</td>
          <td>${formatDate(payment.paid_at)}</td>
        </tr>
      </tbody>
    </table>

    <!-- Balance Summary -->
    <div class="balance-summary">
      <div class="balance-row">
        <div class="bal-label">Fee Amount</div>
        <div class="bal-value">₹ ${formatCurrency(feeAmount)}</div>
      </div>
      <div class="balance-row">
        <div class="bal-label">Total Paid</div>
        <div class="bal-value" style="color:#2e7d32">₹ ${formatCurrency(totalPaid)}</div>
      </div>
      <div class="balance-row highlight ${balance > 0 ? 'balance-due' : 'balance-clear'}">
        <div class="bal-label">Balance Due</div>
        <div class="bal-value">₹ ${formatCurrency(balance)}</div>
      </div>
    </div>

    <div class="issued-line">Generated on ${issuedDate} &nbsp;|&nbsp; ${receiptNumber}</div>
  </div>
  `;
}

// ============================================================
// GENERATE RECEIPT PDF
// ============================================================

async function generatePaymentReceiptPdf({ organizationId, paymentId }) {
  const { payment, student, enrollment, org, totalPaid, feeAmount, balance } =
    await fetchReceiptData({ organizationId, paymentId });

  const receiptNumber = buildReceiptNumber(paymentId);
  const issuedDate    = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const htmlContent = buildReceiptHtml({
    receiptNumber,
    payment,
    student,
    enrollment,
    org,
    totalPaid,
    feeAmount,
    balance,
    issuedDate,
  });

  const outputFileName = `receipt_${paymentId}_${Date.now()}`;

  const result = await generatePdf({
    htmlContent,
    organizationLogo: org.logo_path      || null,
    signatureImage:   org.signature_path || null,
    stampImage:       org.stamp_path     || null,
    watermarkText:    'PAID RECEIPT',
    outputFileName,
  });

  if (!result.success) {
    const err = new Error(`PDF generation failed: ${result.error}`);
    err.statusCode = 500;
    throw err;
  }

  return { filePath: result.filePath, receiptNumber };
}

module.exports = { generatePaymentReceiptPdf };
