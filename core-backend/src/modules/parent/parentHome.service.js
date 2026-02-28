'use strict';

const pool = require('../../config/db');

// ============================================================
// RESOLVE LINKED STUDENTS
// ============================================================

async function fetchLinkedStudents({ organizationId, userId }) {
  const { rows } = await pool.query(
    `SELECT
       s.id                                          AS student_id,
       s.first_name,
       s.last_name,
       COALESCE(c.class_name, c.name)                AS class_name,
       sec.name                                      AS section_name,
       se.academic_year,
       ps.relationship
     FROM   parent_students   ps
     JOIN   students          s   ON s.id   = ps.student_id       AND s.deleted_at IS NULL
     LEFT   JOIN student_enrollments se
                ON se.student_id      = s.id
               AND se.organization_id = ps.organization_id
               AND se.deleted_at IS NULL
     LEFT   JOIN classes      c   ON c.id   = se.class_id         AND c.deleted_at IS NULL
     LEFT   JOIN sections     sec ON sec.id = se.section_id       AND sec.deleted_at IS NULL
     WHERE  ps.user_id         = $1
       AND  ps.organization_id = $2
     ORDER  BY s.first_name ASC`,
    [userId, organizationId]
  );
  return rows;
}

// ============================================================
// PER-STUDENT AGGREGATES  (all in parallel)
// ============================================================

async function fetchAttendanceSummary({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                                           AS total_days,
       COUNT(*) FILTER (WHERE status = 'PRESENT')        AS present_days,
       COUNT(*) FILTER (WHERE status = 'ABSENT')         AS absent_days,
       COUNT(*) FILTER (WHERE status = 'LATE')           AS late_days
     FROM   attendances
     WHERE  student_id      = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );

  const row        = rows[0];
  const totalDays  = parseInt(row.total_days,   10);
  const presentDays = parseInt(row.present_days, 10);
  const absentDays  = parseInt(row.absent_days,  10);
  const lateDays    = parseInt(row.late_days,    10);
  const attendancePct = totalDays > 0
    ? parseFloat(((presentDays + lateDays) / totalDays * 100).toFixed(1))
    : 0;

  return { attendancePercentage: attendancePct, presentDays, absentDays };
}

async function fetchFeesSummary({ organizationId, studentId }) {
  const [balanceResult, lastPaymentResult] = await Promise.all([
    // Total outstanding balance
    pool.query(
      `SELECT COALESCE(
         SUM(sf.amount) - COALESCE(SUM(paid.total_paid), 0)
       , 0) AS total_balance
       FROM student_fees sf
       LEFT JOIN (
         SELECT student_fee_id, SUM(amount) AS total_paid
         FROM   payments
         WHERE  organization_id = $1
           AND  status          = 'SUCCESS'
           AND  deleted_at IS NULL
         GROUP  BY student_fee_id
       ) paid ON paid.student_fee_id = sf.id
       WHERE sf.student_id      = $2
         AND sf.organization_id = $1
         AND sf.status         != 'PAID'
         AND sf.deleted_at IS NULL`,
      [organizationId, studentId]
    ),
    // Last successful payment
    pool.query(
      `SELECT amount, paid_at
       FROM   payments
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  status          = 'SUCCESS'
         AND  deleted_at IS NULL
       ORDER  BY paid_at DESC
       LIMIT  1`,
      [studentId, organizationId]
    ),
  ]);

  const last = lastPaymentResult.rows[0] || null;

  return {
    totalBalance:      parseFloat(balanceResult.rows[0].total_balance),
    lastPaymentAmount: last ? parseFloat(last.amount) : null,
    lastPaymentDate:   last ? last.paid_at            : null,
  };
}

async function fetchUnreadAnnouncementsCount({ organizationId, studentId }) {
  // "Unread" = ANNOUNCEMENT notifications sent in the last 7 days
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count
     FROM   notification_logs
     WHERE  organization_id = $1
       AND  student_id      = $2
       AND  reminder_type   = 'ANNOUNCEMENT'
       AND  status          = 'SUCCESS'
       AND  created_at     >= NOW() - INTERVAL '7 days'`,
    [organizationId, studentId]
  );
  return parseInt(rows[0].count, 10);
}

async function fetchRecentNotifications({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT reminder_type, status, message, created_at
     FROM   notification_logs
     WHERE  student_id      = $1
       AND  organization_id = $2
     ORDER  BY created_at DESC
     LIMIT  5`,
    [studentId, organizationId]
  );
  return rows;
}

// ============================================================
// AGGREGATE ONE STUDENT'S HOME DATA
// ============================================================

async function buildStudentCard({ organizationId, student }) {
  const [attendance, fees, unreadAnnouncements, recentNotifications] = await Promise.all([
    fetchAttendanceSummary({ organizationId, studentId: student.student_id }).catch(() => ({
      attendancePercentage: 0, presentDays: 0, absentDays: 0,
    })),
    fetchFeesSummary({ organizationId, studentId: student.student_id }).catch(() => ({
      totalBalance: 0, lastPaymentAmount: null, lastPaymentDate: null,
    })),
    fetchUnreadAnnouncementsCount({ organizationId, studentId: student.student_id }).catch(() => 0),
    fetchRecentNotifications({ organizationId, studentId: student.student_id }).catch(() => []),
  ]);

  return {
    studentId:    student.student_id,
    studentName:  `${student.first_name} ${student.last_name}`.trim(),
    className:    student.class_name    || null,
    sectionName:  student.section_name  || null,
    academicYear: student.academic_year || null,
    relationship: student.relationship,
    attendanceSummary: attendance,
    feesSummary:       fees,
    announcementsCount: { unreadAnnouncements },
    recentNotifications,
  };
}

// ============================================================
// MAIN
// ============================================================

async function getParentHome({ organizationId, userId }) {
  const students = await fetchLinkedStudents({ organizationId, userId });

  if (students.length === 0) {
    return { students: [] };
  }

  const cards = await Promise.all(
    students.map((s) => buildStudentCard({ organizationId, student: s }))
  );

  return { students: cards };
}

module.exports = { getParentHome };
