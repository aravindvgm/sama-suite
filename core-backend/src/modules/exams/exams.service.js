'use strict';

const pool = require('../../config/db');

// ============================================================
// VALIDATION HELPERS
// ============================================================

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

async function assertExamBelongsToOrg(client, { examId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id, class_id
     FROM   exams
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [examId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Exam not found in this organization');
    err.statusCode = 404;
    throw err;
  }
  return rows[0];
}

function assertMarksRange(marks, maxMarks) {
  if (marks < 0 || maxMarks <= 0 || marks > maxMarks) {
    const err = new Error('marks must be >= 0 and <= max_marks; max_marks must be > 0');
    err.statusCode = 422;
    throw err;
  }
}

// ============================================================
// CREATE EXAM
// ============================================================

async function createExam({ organizationId, userId, classId, examName, examDate }) {
  const { rows } = await pool.query(
    `INSERT INTO exams (organization_id, class_id, exam_name, exam_date, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, organization_id, class_id, exam_name, exam_date, created_by, created_at`,
    [organizationId, classId, examName, examDate, userId]
  );
  return rows[0];
}

// ============================================================
// ADD STUDENT MARKS
// ============================================================

async function addStudentMarks({ organizationId, userId, studentId, enrollmentId, examId, subject, marks, maxMarks }) {
  assertMarksRange(marks, maxMarks);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const enrollment = await assertEnrollmentBelongsToOrg(client, { enrollmentId, organizationId });
    await assertExamBelongsToOrg(client, { examId, organizationId });

    const resolvedStudentId = studentId ?? enrollment.student_id;

    // One subject entry per student per exam
    const { rows: existing } = await client.query(
      `SELECT id FROM student_marks
       WHERE  organization_id = $1
         AND  student_id      = $2
         AND  exam_id         = $3
         AND  subject         = $4
         AND  deleted_at IS NULL`,
      [organizationId, resolvedStudentId, examId, subject]
    );
    if (existing.length > 0) {
      const err = new Error('Marks already recorded for this student, exam and subject');
      err.statusCode = 409;
      throw err;
    }

    const { rows } = await client.query(
      `INSERT INTO student_marks
         (organization_id, student_id, enrollment_id, exam_id, subject, marks, max_marks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, organization_id, student_id, enrollment_id,
                 exam_id, subject, marks, max_marks, created_by, created_at`,
      [organizationId, resolvedStudentId, enrollmentId, examId, subject, marks, maxMarks, userId]
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
// GET STUDENT REPORT
// ============================================================

async function getStudentReport({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       sm.id,
       sm.organization_id,
       sm.student_id,
       sm.enrollment_id,
       sm.exam_id,
       sm.subject,
       sm.marks,
       sm.max_marks,
       ROUND((sm.marks / NULLIF(sm.max_marks, 0)) * 100, 2) AS percentage,
       sm.created_at,
       sm.updated_at,
       e.exam_name,
       e.exam_date,
       e.class_id
     FROM   student_marks sm
     JOIN   exams e ON e.id = sm.exam_id AND e.deleted_at IS NULL
     WHERE  sm.organization_id = $1
       AND  sm.student_id      = $2
       AND  sm.deleted_at IS NULL
     ORDER  BY e.exam_date DESC, sm.subject ASC`,
    [organizationId, studentId]
  );
  return rows;
}

// ============================================================
// GET MARKS BY ID
// ============================================================

async function getMarksById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_id, enrollment_id,
            exam_id, subject, marks, max_marks, created_by, created_at, updated_at
     FROM   student_marks
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// UPDATE MARKS
// ============================================================

async function updateMarks({ organizationId, id, marks, maxMarks }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: current } = await client.query(
      `SELECT marks, max_marks FROM student_marks
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, organizationId]
    );
    if (current.length === 0) {
      const err = new Error('Marks record not found');
      err.statusCode = 404;
      throw err;
    }

    const resolvedMarks    = marks    ?? current[0].marks;
    const resolvedMaxMarks = maxMarks ?? current[0].max_marks;

    assertMarksRange(resolvedMarks, resolvedMaxMarks);

    const { rows } = await client.query(
      `UPDATE student_marks
       SET    marks      = $1,
              max_marks  = $2,
              updated_at = CURRENT_TIMESTAMP
       WHERE  id              = $3
         AND  organization_id = $4
         AND  deleted_at IS NULL
       RETURNING id, organization_id, student_id, enrollment_id,
                 exam_id, subject, marks, max_marks, created_by, created_at, updated_at`,
      [resolvedMarks, resolvedMaxMarks, id, organizationId]
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
// SOFT DELETE MARKS
// ============================================================

async function deleteMarks({ organizationId, userId, id }) {
  const { rows } = await pool.query(
    `UPDATE student_marks
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
  createExam,
  addStudentMarks,
  getStudentReport,
  getMarksById,
  updateMarks,
  deleteMarks,
};
