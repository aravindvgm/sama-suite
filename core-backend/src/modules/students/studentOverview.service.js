'use strict';

const pool = require('../../config/db');

// ============================================================
// SIGNAL 1 — BASIC PROFILE  (doubles as the ownership guard)
//
// Combining profile fetch + ownership check into a single query
// eliminates one unnecessary round-trip.  Throws 404 if the
// student does not exist or does not belong to the organisation.
// ============================================================

async function fetchStudentProfile({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       id,
       admission_number    AS admission_no,
       first_name,
       last_name,
       class_id,
       section_id,
       date_of_birth       AS dob,
       gender,
       photo_url,
       status
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

  return rows[0];
}

// ============================================================
// SIGNAL 2 — ATTENDANCE SUMMARY
// ============================================================

async function fetchAttendanceSummary({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                                               AS total_days,
       COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE')) AS effective_days
     FROM   attendance
     WHERE  student_id      = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );

  const totalDays     = parseInt(rows[0].total_days,     10);
  const effectiveDays = parseInt(rows[0].effective_days, 10);
  const attendancePercentage = totalDays > 0
    ? parseFloat(((effectiveDays / totalDays) * 100).toFixed(1))
    : 100;

  return { totalDays, effectiveDays, attendancePercentage };
}

// ============================================================
// SIGNAL 3 — FEE SUMMARY
//
// Aggregates total billed vs total paid in a single scan.
// Only SUCCESS payments that are not soft-deleted count.
// pendingBalance is derived in JS to avoid float rounding in SQL.
// ============================================================

async function fetchFeeSummary({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(sf.amount),         0) AS total_fee_amount,
       COALESCE(SUM(paid.total_paid),   0) AS total_paid_amount
     FROM   student_fees sf
     LEFT   JOIN (
       SELECT student_fee_id, SUM(amount) AS total_paid
       FROM   payments
       WHERE  organization_id = $2
         AND  status          = 'SUCCESS'
         AND  deleted_at IS NULL
       GROUP  BY student_fee_id
     ) paid ON paid.student_fee_id = sf.id
     WHERE  sf.student_id      = $1
       AND  sf.organization_id = $2
       AND  sf.deleted_at IS NULL`,
    [studentId, organizationId]
  );

  const totalFeeAmount  = parseFloat(rows[0].total_fee_amount);
  const totalPaidAmount = parseFloat(rows[0].total_paid_amount);
  const pendingBalance  = parseFloat((totalFeeAmount - totalPaidAmount).toFixed(2));

  return { totalFeeAmount, totalPaidAmount, pendingBalance };
}

// ============================================================
// SIGNAL 4 — RECENT ACTIVITY
//
// Returns the 5 most recent entries from student_activity_logs.
// Strictly scoped to organization_id for multi-tenant safety.
// ============================================================

async function fetchRecentActivities({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       activity_type,
       description,
       created_at
     FROM   student_activity_logs
     WHERE  student_id      = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL
     ORDER  BY created_at DESC
     LIMIT  5`,
    [studentId, organizationId]
  );

  return rows;
}

// ============================================================
// SIGNAL 5 — LATEST NOTIFICATION STATUS
//
// reminder_type is aliased as "channel" to match the
// contract field name expected by callers.
// Returns null when no notifications exist for this student.
// ============================================================

async function fetchLastNotification({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       reminder_type AS channel,
       status,
       created_at
     FROM   notification_logs
     WHERE  student_id      = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL
     ORDER  BY created_at DESC
     LIMIT  1`,
    [studentId, organizationId]
  );

  return rows[0] || null;
}

// ============================================================
// MAIN
//
// Execution order:
//   1. fetchStudentProfile  — ownership guard + profile (sequential,
//      must succeed before anything else runs)
//   2. Signals 2–5          — all fire concurrently via Promise.all
// ============================================================

async function getStudentOverview({ organizationId, studentId }) {
  // Step 1 — ownership guard + profile (throws 404 on failure)
  const studentProfile = await fetchStudentProfile({ organizationId, studentId });

  // Step 2 — all remaining signals run concurrently
  const [
    attendanceSummary,
    feeSummary,
    recentActivities,
    lastNotification,
  ] = await Promise.all([
    fetchAttendanceSummary({ organizationId, studentId }),
    fetchFeeSummary({ organizationId, studentId }),
    fetchRecentActivities({ organizationId, studentId }),
    fetchLastNotification({ organizationId, studentId }),
  ]);

  return {
    studentProfile,
    attendanceSummary,
    feeSummary,
    recentActivities,
    lastNotification,
  };
}

module.exports = { getStudentOverview };
