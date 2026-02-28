'use strict';

const pool = require('../../config/db');

// ============================================================
// STUDENT EARLY WARNING ENGINE
//
// Returns three lists of at-risk students detected across the
// full organisation.  All three queries run concurrently.
//
// Q1  attendance + students → lowAttendanceStudents   (< 75%)
// Q2  student_fees + payments + students → overdueFeeStudents (> 30 days)
// Q3  notification_logs + students → failedNotificationStudents (>= 3 in 7d)
//
// No per-student loops — pure aggregation queries.
// ============================================================

// ============================================================
// Q1 — LOW ATTENDANCE STUDENTS
//
// JOINs attendance onto students so we only return students who
// actually have records (avoids reporting new students with 0 days).
// HAVING filters to those below the 75% threshold.
// Ordered by worst attendance first for dashboard priority.
// ============================================================

async function fetchLowAttendanceStudents({ organizationId }) {
  const { rows } = await pool.query(
    `SELECT
       s.id                AS student_id,
       s.admission_number  AS admission_no,
       s.first_name,
       s.last_name,
       COUNT(*)            AS total_days,
       COUNT(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE'))
                           AS effective_days,
       ROUND(
         COUNT(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE'))::numeric
         / NULLIF(COUNT(*), 0) * 100
       , 1)                AS attendance_percentage
     FROM   students s
     JOIN   attendance a
            ON  a.student_id      = s.id
            AND a.organization_id = $1
            AND a.deleted_at IS NULL
     WHERE  s.organization_id = $1
       AND  s.deleted_at IS NULL
     GROUP  BY s.id, s.admission_number, s.first_name, s.last_name
     HAVING (
       COUNT(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE'))::numeric
       / NULLIF(COUNT(*), 0)
     ) * 100 < 75
     ORDER  BY attendance_percentage ASC`,
    [organizationId]
  );

  return rows.map((r) => ({
    studentId:            r.student_id,
    admissionNo:          r.admission_no,
    firstName:            r.first_name,
    lastName:             r.last_name,
    totalDays:            parseInt(r.total_days,            10),
    effectiveDays:        parseInt(r.effective_days,        10),
    attendancePercentage: parseFloat(r.attendance_percentage),
  }));
}

// ============================================================
// Q2 — OVERDUE FEE STUDENTS
//
// Identifies students with at least one fee whose due_date is
// more than 30 days in the past AND who still carry an unpaid
// balance (partial payments respected via the paid subquery).
// Ordered by largest outstanding balance first.
// ============================================================

async function fetchOverdueFeeStudents({ organizationId }) {
  const { rows } = await pool.query(
    `SELECT
       s.id                AS student_id,
       s.admission_number  AS admission_no,
       s.first_name,
       s.last_name,
       COUNT(sf.id)        AS overdue_fee_count,
       COALESCE(
         SUM(sf.amount) - COALESCE(SUM(paid.total_paid), 0),
         0
       )                   AS total_overdue_balance
     FROM   students s
     JOIN   student_fees sf
            ON  sf.student_id      = s.id
            AND sf.organization_id = $1
            AND sf.deleted_at IS NULL
            AND sf.status         != 'PAID'
            AND sf.due_date        < CURRENT_DATE - INTERVAL '30 days'
     LEFT   JOIN (
       SELECT student_fee_id, SUM(amount) AS total_paid
       FROM   payments
       WHERE  organization_id = $1
         AND  status          = 'SUCCESS'
         AND  deleted_at IS NULL
       GROUP  BY student_fee_id
     ) paid ON paid.student_fee_id = sf.id
     WHERE  s.organization_id = $1
       AND  s.deleted_at IS NULL
     GROUP  BY s.id, s.admission_number, s.first_name, s.last_name
     HAVING SUM(sf.amount) - COALESCE(SUM(paid.total_paid), 0) > 0
     ORDER  BY total_overdue_balance DESC`,
    [organizationId]
  );

  return rows.map((r) => ({
    studentId:          r.student_id,
    admissionNo:        r.admission_no,
    firstName:          r.first_name,
    lastName:           r.last_name,
    overdueFeeCount:    parseInt(r.overdue_fee_count,     10),
    totalOverdueBalance: parseFloat(r.total_overdue_balance),
  }));
}

// ============================================================
// Q3 — FAILED NOTIFICATION STUDENTS
//
// Identifies students with 3 or more FAILED notification
// delivery attempts in the last 7 days — signals a persistent
// contact reachability problem that needs manual intervention.
// Ordered by highest failure count first.
// ============================================================

async function fetchFailedNotificationStudents({ organizationId }) {
  const { rows } = await pool.query(
    `SELECT
       s.id                AS student_id,
       s.admission_number  AS admission_no,
       s.first_name,
       s.last_name,
       COUNT(nl.id)        AS failed_notification_count
     FROM   students s
     JOIN   notification_logs nl
            ON  nl.student_id      = s.id
            AND nl.organization_id = $1
            AND nl.status          = 'FAILED'
            AND nl.created_at     >= NOW() - INTERVAL '7 days'
     WHERE  s.organization_id = $1
       AND  s.deleted_at IS NULL
     GROUP  BY s.id, s.admission_number, s.first_name, s.last_name
     HAVING COUNT(nl.id) >= 3
     ORDER  BY failed_notification_count DESC`,
    [organizationId]
  );

  return rows.map((r) => ({
    studentId:              r.student_id,
    admissionNo:            r.admission_no,
    firstName:              r.first_name,
    lastName:               r.last_name,
    failedNotificationCount: parseInt(r.failed_notification_count, 10),
  }));
}

// ============================================================
// MAIN
//
// All three detection queries run concurrently.
// summary counts are derived in-memory from result lengths —
// no extra COUNT queries needed.
// ============================================================

async function getStudentEarlyWarning({ organizationId }) {
  const [
    lowAttendanceStudents,
    overdueFeeStudents,
    failedNotificationStudents,
  ] = await Promise.all([
    fetchLowAttendanceStudents({ organizationId }),
    fetchOverdueFeeStudents({ organizationId }),
    fetchFailedNotificationStudents({ organizationId }),
  ]);

  return {
    summary: {
      lowAttendanceCount:       lowAttendanceStudents.length,
      overdueFeeCount:          overdueFeeStudents.length,
      failedNotificationCount:  failedNotificationStudents.length,
    },
    lowAttendanceStudents,
    overdueFeeStudents,
    failedNotificationStudents,
  };
}

module.exports = {
  getStudentEarlyWarning,
  fetchLowAttendanceStudents,
  fetchOverdueFeeStudents,
  fetchFailedNotificationStudents,
};
