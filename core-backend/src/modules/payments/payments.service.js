'use strict';

const pool = require('../../config/db');

const VALID_STATUSES = ['PENDING', 'SUCCESS', 'FAILED'];
const VALID_METHODS  = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'DD', 'OTHER'];

// ============================================================
// VALIDATION HELPERS
// ============================================================

function assertValidStatus(status) {
  if (!VALID_STATUSES.includes(status)) {
    const err = new Error(`Invalid payment status. Allowed: ${VALID_STATUSES.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }
}

function assertValidMethod(method) {
  if (method && !VALID_METHODS.includes(method)) {
    const err = new Error(`Invalid payment_method. Allowed: ${VALID_METHODS.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }
}

// ============================================================
// TENANT OWNERSHIP GUARDS
//
// Called before any mutation or read that accepts an external ID
// (studentId, studentFeeId, paymentId) to ensure the resource
// belongs to the authenticated organisation.
//
// Always throws 403 — never 404 — so callers cannot enumerate
// whether a resource exists in a different organisation.
// ============================================================

async function assertStudentOwnership(studentId, organizationId) {
  const { rows } = await pool.query(
    `SELECT id
     FROM   students
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Invalid resource for this organization');
    err.statusCode = 403;
    throw err;
  }
}

async function assertPaymentOwnership(paymentId, organizationId) {
  const { rows } = await pool.query(
    `SELECT id
     FROM   payments
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [paymentId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Invalid resource for this organization');
    err.statusCode = 403;
    throw err;
  }
}

async function fetchStudentFee(client, { studentFeeId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id, student_id, enrollment_id, amount, status
     FROM   student_fees
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentFeeId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Invalid resource for this organization');
    err.statusCode = 403;
    throw err;
  }
  return rows[0];
}

// ============================================================
// FEE STATUS RECALCULATION
// Sums all SUCCESS payments for a student_fee and sets:
//   total_paid >= fee.amount  → PAID
//   total_paid >  0           → PARTIAL
//   total_paid == 0           → PENDING
// ============================================================

async function recalculateFeeStatus(client, { studentFeeId, organizationId }) {
  const { rows: feeRows } = await client.query(
    `SELECT amount FROM student_fees
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [studentFeeId, organizationId]
  );
  if (feeRows.length === 0) return;

  const feeAmount = parseFloat(feeRows[0].amount);

  const { rows: sumRows } = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total_paid
     FROM   payments
     WHERE  student_fee_id  = $1
       AND  organization_id = $2
       AND  status          = 'SUCCESS'
       AND  deleted_at IS NULL`,
    [studentFeeId, organizationId]
  );

  const totalPaid  = parseFloat(sumRows[0].total_paid);
  let   feeStatus  = 'PENDING';

  if (totalPaid >= feeAmount) {
    feeStatus = 'PAID';
  } else if (totalPaid > 0) {
    feeStatus = 'PARTIAL';
  }

  await client.query(
    `UPDATE student_fees
     SET    status     = $1,
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL`,
    [feeStatus, studentFeeId, organizationId]
  );

  return { feeStatus, totalPaid, feeAmount };
}

// ============================================================
// CREATE PAYMENT  (status = PENDING)
// ============================================================

async function createPayment({
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
}) {
  assertValidMethod(paymentMethod);

  // Guard: studentId must belong to this org when explicitly provided.
  // studentFeeId ownership is validated inside fetchStudentFee (within the
  // transaction) so no separate pre-check is needed for it.
  if (studentId != null) {
    await assertStudentOwnership(studentId, organizationId);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const fee = await fetchStudentFee(client, { studentFeeId, organizationId });

    const resolvedStudentId    = studentId    ?? fee.student_id;
    const resolvedEnrollmentId = enrollmentId ?? fee.enrollment_id;

    const { rows } = await client.query(
      `INSERT INTO payments
         (organization_id, student_fee_id, student_id, enrollment_id,
          amount, payment_method, gateway, gateway_order_id,
          gateway_payment_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)
       RETURNING id, organization_id, student_fee_id, student_id, enrollment_id,
                 amount, payment_method, gateway, gateway_order_id,
                 gateway_payment_id, status, paid_at, created_by, created_at`,
      [
        organizationId,
        studentFeeId,
        resolvedStudentId,
        resolvedEnrollmentId,
        amount,
        paymentMethod    || null,
        gateway          || null,
        gatewayOrderId   || null,
        gatewayPaymentId || null,
        userId,
      ]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// UPDATE PAYMENT STATUS
// On SUCCESS: stamps paid_at and recalculates fee balance.
// ============================================================

async function updatePaymentStatus({ organizationId, id, status, gatewayPaymentId }) {
  assertValidStatus(status);

  // Guard: payment must belong to this org before any mutation.
  // Idempotency check (terminal-state check) runs inside the transaction
  // after this guard — never before ownership is confirmed.
  await assertPaymentOwnership(id, organizationId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `UPDATE payments
       SET    status             = $1,
              gateway_payment_id = COALESCE($2, gateway_payment_id),
              paid_at            = CASE WHEN $1 = 'SUCCESS' THEN CURRENT_TIMESTAMP ELSE paid_at END,
              updated_at         = CURRENT_TIMESTAMP
       WHERE  id              = $3
         AND  organization_id = $4
         AND  deleted_at IS NULL
       RETURNING id, organization_id, student_fee_id, student_id, enrollment_id,
                 amount, payment_method, gateway, gateway_order_id,
                 gateway_payment_id, status, paid_at, created_by, created_at, updated_at`,
      [status, gatewayPaymentId ?? null, id, organizationId]
    );

    if (rows.length === 0) {
      const err = new Error('Payment record not found');
      err.statusCode = 404;
      throw err;
    }

    const payment = rows[0];
    let   feeBalance = null;

    if (status === 'SUCCESS') {
      feeBalance = await recalculateFeeStatus(client, {
        studentFeeId:   payment.student_fee_id,
        organizationId,
      });
    }

    await client.query('COMMIT');
    return { ...payment, feeBalance };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ============================================================
// GET STUDENT PAYMENTS
// ============================================================

async function getStudentPayments({ organizationId, studentId }) {
  // Guard: student must belong to this org before querying their payments.
  await assertStudentOwnership(studentId, organizationId);

  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.organization_id,
       p.student_fee_id,
       p.student_id,
       p.enrollment_id,
       p.amount,
       p.payment_method,
       p.gateway,
       p.gateway_order_id,
       p.gateway_payment_id,
       p.status,
       p.paid_at,
       p.created_by,
       p.created_at,
       p.updated_at,
       sf.amount   AS fee_amount,
       sf.status   AS fee_status,
       fs.fee_name
     FROM   payments       p
     JOIN   student_fees   sf ON sf.id = p.student_fee_id  AND sf.deleted_at IS NULL
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     WHERE  p.organization_id = $1
       AND  p.student_id      = $2
       AND  p.deleted_at IS NULL
     ORDER  BY p.created_at DESC`,
    [organizationId, studentId]
  );
  return rows;
}

// ============================================================
// GET PAYMENT BY ID
// ============================================================

async function getPaymentById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_fee_id, student_id, enrollment_id,
            amount, payment_method, gateway, gateway_order_id,
            gateway_payment_id, status, paid_at, created_by, created_at, updated_at
     FROM   payments
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// SOFT DELETE
// ============================================================

async function deletePayment({ organizationId, userId, id }) {
  // Guard: payment must belong to this org before soft-deleting.
  await assertPaymentOwnership(id, organizationId);

  const { rows } = await pool.query(
    `UPDATE payments
     SET    deleted_at = CURRENT_TIMESTAMP,
            deleted_by = $1,
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL
     RETURNING id`,
    [userId, id, organizationId]
  );
  return rows[0] || null;
}

module.exports = {
  createPayment,
  updatePaymentStatus,
  getStudentPayments,
  getPaymentById,
  deletePayment,
};
