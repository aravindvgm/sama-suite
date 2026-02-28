'use strict';

const pool = require('../../config/db');

const VALID_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

// ============================================================
// VALIDATION HELPERS
// ============================================================

function assertValidStatus(status) {
  if (!VALID_STATUSES.includes(status)) {
    const err = new Error(`Invalid status. Allowed: ${VALID_STATUSES.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }
}

async function assertEnrollmentBelongsToOrg(client, { enrollmentId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id, student_id
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

// ============================================================
// MARK ATTENDANCE
// ============================================================

async function markAttendance({ organizationId, userId, enrollmentId, studentId, attendanceDate, status }) {
  assertValidStatus(status);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Validate enrollment belongs to org and resolve studentId if not provided
    const enrollment = await assertEnrollmentBelongsToOrg(client, { enrollmentId, organizationId });
    const resolvedStudentId = studentId ?? enrollment.student_id;

    // One attendance record per student per date (within org)
    const { rows: existing } = await client.query(
      `SELECT id FROM attendance
       WHERE  organization_id  = $1
         AND  student_id       = $2
         AND  attendance_date  = $3
         AND  deleted_at IS NULL`,
      [organizationId, resolvedStudentId, attendanceDate]
    );
    if (existing.length > 0) {
      const err = new Error('Attendance already marked for this student on the given date');
      err.statusCode = 409;
      throw err;
    }

    const { rows } = await client.query(
      `INSERT INTO attendance
         (organization_id, student_id, enrollment_id, attendance_date, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, student_id, enrollment_id, attendance_date, status, created_by, created_at`,
      [organizationId, resolvedStudentId, enrollmentId, attendanceDate, status, userId]
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
// GET ATTENDANCE BY DATE
// ============================================================

async function getAttendanceByDate({ organizationId, date }) {
  if (!date) {
    const err = new Error('Query parameter "date" is required (YYYY-MM-DD)');
    err.statusCode = 422;
    throw err;
  }

  const { rows } = await pool.query(
    `SELECT
       a.id,
       a.organization_id,
       a.student_id,
       a.enrollment_id,
       a.attendance_date,
       a.status,
       a.created_by,
       a.created_at,
       a.updated_at,
       s.first_name,
       s.last_name
     FROM   attendance a
     JOIN   students   s ON s.id = a.student_id AND s.deleted_at IS NULL
     WHERE  a.organization_id = $1
       AND  a.attendance_date = $2
       AND  a.deleted_at IS NULL
     ORDER  BY s.last_name ASC, s.first_name ASC`,
    [organizationId, date]
  );
  return rows;
}

// ============================================================
// GET ATTENDANCE BY ID
// ============================================================

async function getAttendanceById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_id, enrollment_id,
            attendance_date, status, created_by, created_at, updated_at
     FROM   attendance
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// UPDATE ATTENDANCE
// ============================================================

async function updateAttendance({ organizationId, id, status }) {
  assertValidStatus(status);

  const { rows } = await pool.query(
    `UPDATE attendance
     SET    status     = $1,
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL
     RETURNING id, organization_id, student_id, enrollment_id,
               attendance_date, status, created_by, created_at, updated_at`,
    [status, id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// SOFT DELETE ATTENDANCE
// ============================================================

async function deleteAttendance({ organizationId, userId, id }) {
  const { rows } = await pool.query(
    `UPDATE attendance
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
  markAttendance,
  getAttendanceByDate,
  getAttendanceById,
  updateAttendance,
  deleteAttendance,
};
