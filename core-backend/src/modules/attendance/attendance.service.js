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

// ============================================================
// GET SECTION ROSTER (teacher load screen)
// Returns students enrolled in a section with today's attendance
// status (null if not yet marked). Single query via LEFT JOIN.
// ============================================================

async function getSectionRoster({ organizationId, sectionId, date }) {
  // Resolve section + class name (used in response header)
  const { rows: sectionRows } = await pool.query(
    `SELECT s.name AS section_name, c.name AS class_name
     FROM   sections s
     JOIN   classes  c ON c.id = s.class_id AND c.deleted_at IS NULL
     WHERE  s.id              = $1
       AND  s.organization_id = $2
       AND  s.deleted_at IS NULL`,
    [sectionId, organizationId]
  );
  if (sectionRows.length === 0) {
    const err = new Error('Section not found');
    err.statusCode = 404;
    throw err;
  }
  const { section_name, class_name } = sectionRows[0];

  // Roster with current attendance status (null = not yet marked)
  const { rows } = await pool.query(
    `SELECT
       se.student_id,
       se.id           AS enrollment_id,
       s.first_name,
       s.last_name,
       a.status
     FROM   student_enrollments se
     JOIN   students             s  ON s.id  = se.student_id
                                   AND s.deleted_at IS NULL
     LEFT   JOIN attendance      a  ON a.student_id      = se.student_id
                                   AND a.organization_id = $1
                                   AND a.attendance_date = $3
                                   AND a.deleted_at IS NULL
     WHERE  se.organization_id = $1
       AND  se.section_id      = $2
       AND  se.deleted_at IS NULL
     ORDER  BY s.last_name ASC, s.first_name ASC`,
    [organizationId, sectionId, date]
  );

  return { sectionName: section_name, className: class_name, date, students: rows };
}

// ============================================================
// BULK UPSERT ATTENDANCE (teacher bulk mark)
// Accepts an array of { studentId, enrollmentId, status }.
// Uses array unnesting for a single-query bulk UPSERT — no N+1.
// ON CONFLICT DO UPDATE makes this fully idempotent (safe to retry).
// ============================================================

async function bulkUpsertAttendance({ organizationId, sectionId, date, records, userId }) {
  if (!Array.isArray(records) || records.length === 0) {
    const err = new Error('records must be a non-empty array');
    err.statusCode = 422;
    throw err;
  }
  if (records.length > 500) {
    const err = new Error('Batch size exceeds maximum of 500 records');
    err.statusCode = 422;
    throw err;
  }

  // Validate each status before touching DB
  for (const r of records) {
    assertValidStatus(r.status);
  }

  // Verify the section belongs to this org (single query)
  const { rows: secCheck } = await pool.query(
    `SELECT id FROM sections
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [sectionId, organizationId]
  );
  if (secCheck.length === 0) {
    const err = new Error('Section not found');
    err.statusCode = 404;
    throw err;
  }

  const studentIds    = records.map(r => r.studentId);
  const enrollmentIds = records.map(r => r.enrollmentId);
  const statuses      = records.map(r => r.status);

  // Single-query bulk UPSERT via unnest.
  // ON CONFLICT restores soft-deleted rows (sets deleted_at = NULL).
  const { rowCount } = await pool.query(
    `INSERT INTO attendance
       (organization_id, student_id, enrollment_id, attendance_date, status, created_by)
     SELECT
       $1,
       UNNEST($2::uuid[]),
       UNNEST($3::uuid[]),
       $4::date,
       UNNEST($5::text[]),
       $6
     ON CONFLICT (organization_id, student_id, attendance_date)
     DO UPDATE SET
       status        = EXCLUDED.status,
       enrollment_id = EXCLUDED.enrollment_id,
       updated_at    = NOW(),
       deleted_at    = NULL,
       deleted_by    = NULL`,
    [organizationId, studentIds, enrollmentIds, date, statuses, userId]
  );

  return { saved: rowCount };
}

// ============================================================
// GET STUDENT ATTENDANCE SUMMARY (parent view)
// Returns today + last 7 calendar days in a single query.
// ============================================================

async function getStudentAttendanceSummary({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       attendance_date,
       status
     FROM   attendance
     WHERE  organization_id = $1
       AND  student_id      = $2
       AND  attendance_date >= CURRENT_DATE - INTERVAL '6 days'
       AND  attendance_date <= CURRENT_DATE
       AND  deleted_at IS NULL
     ORDER  BY attendance_date DESC`,
    [organizationId, studentId]
  );
  return rows;
}

// ============================================================
// GET ATTENDANCE DASHBOARD (principal view)
// Two queries — both scoped to today (passed as param so the
// controller can accept ?date= for testing without TIME zone issues).
// Uses array_agg-free approach to avoid large intermediate sets.
// ============================================================

async function getAttendanceDashboard({ organizationId, date }) {
  // Query 1: today's aggregate stats
  const { rows: stats } = await pool.query(
    `SELECT
       COUNT(*)                                                AS marked_count,
       COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE'))  AS present_count,
       COUNT(*) FILTER (WHERE status = 'ABSENT')              AS absent_count
     FROM   attendance
     WHERE  organization_id = $1
       AND  attendance_date = $2
       AND  deleted_at IS NULL`,
    [organizationId, date]
  );

  // Query 2: total enrolled students (denominator for attendance %)
  const { rows: totals } = await pool.query(
    `SELECT COUNT(DISTINCT student_id) AS total_students
     FROM   student_enrollments
     WHERE  organization_id = $1
       AND  deleted_at IS NULL`,
    [organizationId]
  );

  // Query 3: repeat absentees — 3+ absent days in the last 7 calendar days
  // Uses the partial index idx_att_org_date_absent (status='ABSENT').
  const { rows: absentees } = await pool.query(
    `SELECT
       s.id         AS student_id,
       s.first_name,
       s.last_name,
       COUNT(*)     AS absent_days
     FROM   attendance  a
     JOIN   students    s ON s.id = a.student_id AND s.deleted_at IS NULL
     WHERE  a.organization_id = $1
       AND  a.attendance_date >= $2::date - INTERVAL '6 days'
       AND  a.attendance_date <= $2::date
       AND  a.status           = 'ABSENT'
       AND  a.deleted_at IS NULL
     GROUP  BY s.id, s.first_name, s.last_name
     HAVING COUNT(*) >= 3
     ORDER  BY absent_days DESC, s.last_name ASC`,
    [organizationId, date]
  );

  const totalStudents  = parseInt(totals[0]?.total_students  || 0, 10);
  const presentCount   = parseInt(stats[0]?.present_count   || 0, 10);
  const absentCount    = parseInt(stats[0]?.absent_count    || 0, 10);
  const attendancePercent = totalStudents > 0
    ? Math.round((presentCount / totalStudents) * 1000) / 10   // 1 decimal place
    : 0;

  return {
    date,
    totalStudents,
    presentCount,
    absentCount,
    attendancePercent,
    repeatAbsentees: absentees,
  };
}

module.exports = {
  markAttendance,
  getAttendanceByDate,
  getAttendanceById,
  updateAttendance,
  deleteAttendance,
  getSectionRoster,
  bulkUpsertAttendance,
  getStudentAttendanceSummary,
  getAttendanceDashboard,
};
