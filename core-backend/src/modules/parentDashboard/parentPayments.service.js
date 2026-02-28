'use strict';

const pool = require('../../config/db');

// ============================================================
// STUDENT OWNERSHIP GUARD
// ============================================================

async function assertStudentBelongsToOrg({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT id
     FROM   students
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }
}

// ============================================================
// FULL LEDGER QUERY
// Each fee row + aggregated payment history + receipt flag +
// reminder count — all in two focused queries to keep it fast.
// ============================================================

async function fetchFeeLedger({ organizationId, studentId }) {
  // ── Query 1: All fees with live paid balance ───────────────
  const { rows: feeRows } = await pool.query(
    `SELECT
       sf.id                                                  AS fee_id,
       fs.fee_name,
       sf.amount                                              AS fee_amount,
       sf.due_date,
       sf.status                                              AS fee_status,
       COALESCE(paid.total_paid, 0)                           AS total_paid,
       sf.amount - COALESCE(paid.total_paid, 0)               AS balance
     FROM   student_fees   sf
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     LEFT   JOIN (
       SELECT student_fee_id,
              SUM(amount) AS total_paid
       FROM   payments
       WHERE  status          = 'SUCCESS'
         AND  organization_id = $2
         AND  deleted_at IS NULL
       GROUP  BY student_fee_id
     ) paid ON paid.student_fee_id = sf.id
     WHERE  sf.student_id      = $1
       AND  sf.organization_id = $2
       AND  sf.deleted_at IS NULL
     ORDER  BY sf.due_date ASC`,
    [studentId, organizationId]
  );

  if (feeRows.length === 0) return [];

  const feeIds = feeRows.map((f) => f.fee_id);

  // ── Query 2: Payment history per fee ──────────────────────
  const { rows: paymentRows } = await pool.query(
    `SELECT
       p.id                  AS payment_id,
       p.student_fee_id,
       p.amount,
       p.status,
       p.payment_method,
       p.gateway,
       p.gateway_payment_id,
       p.paid_at,
       p.created_at
     FROM   payments p
     WHERE  p.student_fee_id  = ANY($1::uuid[])
       AND  p.organization_id = $2
       AND  p.deleted_at IS NULL
     ORDER  BY p.created_at DESC`,
    [feeIds, organizationId]
  );

  // ── Query 3: Receipt availability (SUCCESS payments) ──────
  // A receipt exists for any SUCCESS payment row — map by fee_id
  const receiptableFeeIds = new Set(
    paymentRows
      .filter((p) => p.status === 'SUCCESS')
      .map((p) => p.student_fee_id)
  );

  // ── Query 4: Reminder sent count per fee ──────────────────
  const { rows: reminderRows } = await pool.query(
    `SELECT fee_id, COUNT(*) AS sent_count
     FROM   notification_logs
     WHERE  fee_id          = ANY($1::uuid[])
       AND  organization_id = $2
       AND  status          = 'SUCCESS'
     GROUP  BY fee_id`,
    [feeIds, organizationId]
  );

  const reminderCountMap = Object.fromEntries(
    reminderRows.map((r) => [r.fee_id, parseInt(r.sent_count, 10)])
  );

  // ── Group payments by fee_id ───────────────────────────────
  const paymentsByFee = {};
  for (const p of paymentRows) {
    if (!paymentsByFee[p.student_fee_id]) paymentsByFee[p.student_fee_id] = [];
    paymentsByFee[p.student_fee_id].push({
      paymentId:        p.payment_id,
      amount:           parseFloat(p.amount),
      status:           p.status,
      paymentMethod:    p.payment_method || null,
      gateway:          p.gateway        || null,
      gatewayPaymentId: p.gateway_payment_id || null,
      paidAt:           p.paid_at   || null,
      createdAt:        p.created_at,
    });
  }

  // ── Assemble ledger ────────────────────────────────────────
  return feeRows.map((fee) => ({
    feeId:           fee.fee_id,
    feeName:         fee.fee_name,
    feeAmount:       parseFloat(fee.fee_amount),
    dueDate:         fee.due_date,
    feeStatus:       fee.fee_status,
    totalPaid:       parseFloat(fee.total_paid),
    balance:         Math.max(0, parseFloat(fee.balance)),
    receiptAvailable: receiptableFeeIds.has(fee.fee_id),
    remindersSent:   reminderCountMap[fee.fee_id] || 0,
    paymentHistory:  paymentsByFee[fee.fee_id]   || [],
  }));
}

// ============================================================
// LEDGER SUMMARY
// ============================================================

function buildSummary(ledger) {
  return ledger.reduce(
    (acc, fee) => {
      acc.totalFeeAmount += fee.feeAmount;
      acc.totalPaid      += fee.totalPaid;
      acc.totalBalance   += fee.balance;
      if (fee.feeStatus === 'PAID')    acc.paidCount++;
      if (fee.feeStatus === 'PARTIAL') acc.partialCount++;
      if (fee.feeStatus === 'PENDING') acc.pendingCount++;
      return acc;
    },
    {
      totalFeeAmount: 0,
      totalPaid:      0,
      totalBalance:   0,
      paidCount:      0,
      partialCount:   0,
      pendingCount:   0,
    }
  );
}

// ============================================================
// MAIN SERVICE FUNCTION
// ============================================================

async function getParentPaymentLedger({ organizationId, studentId }) {
  await assertStudentBelongsToOrg({ organizationId, studentId });

  const ledger  = await fetchFeeLedger({ organizationId, studentId });
  const summary = buildSummary(ledger);

  return { summary, ledger };
}

module.exports = { getParentPaymentLedger };
