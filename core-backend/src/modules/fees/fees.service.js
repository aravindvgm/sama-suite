'use strict';

const pool = require('../../config/db');

const VALID_FEE_STATUSES = ['PENDING', 'PAID', 'PARTIAL'];

// ============================================================
// VALIDATION HELPERS
// ============================================================

function assertValidFeeStatus(status) {
  if (!VALID_FEE_STATUSES.includes(status)) {
    const err = new Error(`Invalid fee status. Allowed: ${VALID_FEE_STATUSES.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }
}

async function assertEnrollmentBelongsToOrg(client, { enrollmentId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id, student_id, class_id
     FROM   student_enrollments
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [enrollmentId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Enrollment not found in this organization');
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

async function assertFeeStructureBelongsToOrg(client, { feeStructureId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id, amount
     FROM   fee_structures
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [feeStructureId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Fee structure not found in this organization');
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

// ============================================================
// FEE STRUCTURES
// ============================================================

async function createFeeStructure({ organizationId, userId, classId, feeName, amount }) {
  const { rows } = await pool.query(
    `INSERT INTO fee_structures (organization_id, class_id, fee_name, amount, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, organization_id, class_id, fee_name, amount, created_by, created_at`,
    [organizationId, classId, feeName, amount, userId]
  );
  return rows[0];
}

// ============================================================
// ASSIGN FEE TO STUDENT
// ============================================================

async function assignFeeToStudent({ organizationId, userId, studentId, enrollmentId, feeStructureId, amount, dueDate }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const enrollment = await assertEnrollmentBelongsToOrg(client, { enrollmentId, organizationId });
    const structure  = await assertFeeStructureBelongsToOrg(client, { feeStructureId, organizationId });

    // Use overridden amount if provided, otherwise inherit from structure
    const resolvedAmount     = amount      ?? structure.amount;
    const resolvedStudentId  = studentId   ?? enrollment.student_id;

    const { rows } = await client.query(
      `INSERT INTO student_fees
         (organization_id, student_id, enrollment_id, fee_structure_id, amount, due_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7)
       RETURNING id, organization_id, student_id, enrollment_id,
                 fee_structure_id, amount, due_date, status, created_by, created_at`,
      [organizationId, resolvedStudentId, enrollmentId, feeStructureId, resolvedAmount, dueDate, userId]
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
// GET STUDENT FEES
// ============================================================

async function getStudentFees({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       sf.id,
       sf.organization_id,
       sf.student_id,
       sf.enrollment_id,
       sf.fee_structure_id,
       sf.amount,
       sf.due_date,
       sf.status,
       sf.created_by,
       sf.created_at,
       sf.updated_at,
       fs.fee_name,
       fs.class_id
     FROM   student_fees sf
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     WHERE  sf.organization_id = $1
       AND  sf.student_id      = $2
       AND  sf.deleted_at IS NULL
     ORDER  BY sf.due_date ASC`,
    [organizationId, studentId]
  );
  return rows;
}

// ============================================================
// GET FEE BY ID
// ============================================================

async function getFeeById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_id, enrollment_id,
            fee_structure_id, amount, due_date, status,
            created_by, created_at, updated_at
     FROM   student_fees
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// UPDATE FEE STATUS
// ============================================================

async function updateFeeStatus({ organizationId, id, status }) {
  assertValidFeeStatus(status);

  const { rows } = await pool.query(
    `UPDATE student_fees
     SET    status     = $1,
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL
     RETURNING id, organization_id, student_id, enrollment_id,
               fee_structure_id, amount, due_date, status,
               created_by, created_at, updated_at`,
    [status, id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// SOFT DELETE FEE
// ============================================================

async function deleteFee({ organizationId, userId, id }) {
  const { rows } = await pool.query(
    `UPDATE student_fees
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
  createFeeStructure,
  assignFeeToStudent,
  getStudentFees,
  getFeeById,
  updateFeeStatus,
  deleteFee,
};
