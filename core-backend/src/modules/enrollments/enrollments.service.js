'use strict';

const pool = require('../../config/db');

// ============================================================
// VALIDATION HELPERS
// ============================================================

async function assertStudentBelongsToOrg(client, { studentId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id FROM students
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [studentId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Student not found in this organization');
    err.statusCode = 404;
    throw err;
  }
}

async function assertClassBelongsToOrg(client, { classId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id FROM classes
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [classId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Class not found in this organization');
    err.statusCode = 404;
    throw err;
  }
}

async function assertSectionBelongsToClass(client, { sectionId, classId, organizationId }) {
  if (!sectionId) return;
  const { rows } = await client.query(
    `SELECT id FROM sections
     WHERE id = $1 AND class_id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
    [sectionId, classId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Section not found in this class');
    err.statusCode = 404;
    throw err;
  }
}

// ============================================================
// ENROLL STUDENT
// ============================================================

async function enrollStudent({ organizationId, userId, studentId, classId, sectionId, academicYear }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await assertStudentBelongsToOrg(client, { studentId, organizationId });
    await assertClassBelongsToOrg(client, { classId, organizationId });
    await assertSectionBelongsToClass(client, { sectionId, classId, organizationId });

    // Prevent duplicate active enrollment for same student + class + academic year
    const { rows: existing } = await client.query(
      `SELECT id FROM student_enrollments
       WHERE  organization_id = $1
         AND  student_id      = $2
         AND  class_id        = $3
         AND  academic_year   = $4
         AND  deleted_at IS NULL`,
      [organizationId, studentId, classId, academicYear]
    );
    if (existing.length > 0) {
      const err = new Error('Student is already enrolled in this class for the given academic year');
      err.statusCode = 409;
      throw err;
    }

    const { rows } = await client.query(
      `INSERT INTO student_enrollments
         (organization_id, student_id, class_id, section_id, academic_year, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, student_id, class_id, section_id, academic_year, created_by, created_at`,
      [organizationId, studentId, classId, sectionId ?? null, academicYear, userId]
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
// GET ENROLLMENTS BY STUDENT
// ============================================================

async function getStudentEnrollment({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       se.id,
       se.organization_id,
       se.student_id,
       se.class_id,
       se.section_id,
       se.academic_year,
       se.created_by,
       se.created_at,
       se.updated_at,
       c.name  AS class_name,
       s.name  AS section_name
     FROM   student_enrollments se
     LEFT   JOIN classes  c ON c.id = se.class_id   AND c.deleted_at  IS NULL
     LEFT   JOIN sections s ON s.id = se.section_id AND s.deleted_at  IS NULL
     WHERE  se.organization_id = $1
       AND  se.student_id      = $2
       AND  se.deleted_at IS NULL
     ORDER  BY se.academic_year DESC, se.created_at DESC`,
    [organizationId, studentId]
  );
  return rows;
}

// ============================================================
// GET ENROLLMENT BY ID
// ============================================================

async function getEnrollmentById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_id, class_id, section_id,
            academic_year, created_by, created_at, updated_at
     FROM   student_enrollments
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// UPDATE ENROLLMENT
// ============================================================

async function updateEnrollment({ organizationId, userId, id, classId, sectionId, academicYear }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: current } = await client.query(
      `SELECT * FROM student_enrollments
       WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
      [id, organizationId]
    );
    if (current.length === 0) {
      const err = new Error('Enrollment not found');
      err.statusCode = 404;
      throw err;
    }

    const resolved = {
      classId:      classId      ?? current[0].class_id,
      sectionId:    sectionId    ?? current[0].section_id,
      academicYear: academicYear ?? current[0].academic_year,
    };

    if (classId) {
      await assertClassBelongsToOrg(client, { classId: resolved.classId, organizationId });
    }
    if (sectionId) {
      await assertSectionBelongsToClass(client, {
        sectionId:    resolved.sectionId,
        classId:      resolved.classId,
        organizationId,
      });
    }

    const { rows } = await client.query(
      `UPDATE student_enrollments
       SET    class_id      = $1,
              section_id    = $2,
              academic_year = $3,
              updated_at    = CURRENT_TIMESTAMP
       WHERE  id              = $4
         AND  organization_id = $5
         AND  deleted_at IS NULL
       RETURNING id, organization_id, student_id, class_id, section_id,
                 academic_year, created_by, created_at, updated_at`,
      [resolved.classId, resolved.sectionId, resolved.academicYear, id, organizationId]
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
// SOFT DELETE ENROLLMENT
// ============================================================

async function deleteEnrollment({ organizationId, userId, id }) {
  const { rows } = await pool.query(
    `UPDATE student_enrollments
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
  enrollStudent,
  getStudentEnrollment,
  getEnrollmentById,
  updateEnrollment,
  deleteEnrollment,
};
