'use strict';

const pool = require('../../config/db');

// ============================================================
// BASIC INFO  (student + latest enrollment + class + section)
// ============================================================

async function fetchBasicInfo({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       s.id                                        AS student_id,
       s.first_name,
       s.last_name,
       s.admission_number,
       COALESCE(c.class_name, c.name)              AS class_name,
       sec.name                                    AS section_name,
       se.academic_year
     FROM   students s
     LEFT   JOIN student_enrollments se
                ON se.student_id      = s.id
               AND se.organization_id = $2
               AND se.deleted_at IS NULL
     LEFT   JOIN classes  c   ON c.id   = se.class_id    AND c.deleted_at IS NULL
     LEFT   JOIN sections sec ON sec.id = se.section_id  AND sec.deleted_at IS NULL
     WHERE  s.id              = $1
       AND  s.organization_id = $2
       AND  s.deleted_at IS NULL
     ORDER  BY se.created_at DESC
     LIMIT  1`,
    [studentId, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }

  const r = rows[0];
  return {
    studentId:       r.student_id,
    studentName:     `${r.first_name} ${r.last_name}`.trim(),
    class:           r.class_name       || null,
    section:         r.section_name     || null,
    academicYear:    r.academic_year    || null,
    admissionNumber: r.admission_number || null,
  };
}

// ============================================================
// ATTENDANCE SUMMARY
// ============================================================

async function fetchAttendanceSummary({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)                                         AS total_days,
       COUNT(*) FILTER (WHERE status = 'PRESENT')       AS present_days,
       COUNT(*) FILTER (WHERE status = 'ABSENT')        AS absent_days,
       COUNT(*) FILTER (WHERE status = 'LATE')          AS late_days
     FROM   attendance
     WHERE  student_id      = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );

  const row         = rows[0];
  const totalDays   = parseInt(row.total_days,    10);
  const presentDays = parseInt(row.present_days,  10);
  const absentDays  = parseInt(row.absent_days,   10);
  const lateDays    = parseInt(row.late_days,     10);
  const pct = totalDays > 0
    ? parseFloat(((presentDays + lateDays) / totalDays * 100).toFixed(1))
    : 0;

  return { attendancePercentage: pct, presentDays, absentDays };
}

// ============================================================
// FINANCE SUMMARY
// ============================================================

async function fetchFinanceSummary({ organizationId, studentId }) {
  const [balanceResult, lastPaymentResult] = await Promise.all([
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
    lastPaymentDate:   last ? last.paid_at             : null,
  };
}

// ============================================================
// PAYMENT COUNTS
// ============================================================

async function fetchPaymentCounts({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'SUCCESS') AS successful_count,
       COUNT(*) FILTER (WHERE status = 'FAILED')  AS failed_count
     FROM   payments
     WHERE  student_id      = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );

  return {
    successfulPaymentsCount: parseInt(rows[0].successful_count, 10),
    failedPaymentsCount:     parseInt(rows[0].failed_count,     10),
  };
}

// ============================================================
// COMMUNICATION
// ============================================================

async function fetchCommunicationData({ organizationId, studentId }) {
  const [notifResult, announcementResult] = await Promise.all([
    pool.query(
      `SELECT reminder_type, status, message, message_id, error_message, attempts, created_at
       FROM   notification_logs
       WHERE  student_id      = $1
         AND  organization_id = $2
       ORDER  BY created_at DESC
       LIMIT  5`,
      [studentId, organizationId]
    ),
    pool.query(
      `SELECT COUNT(*) AS count
       FROM   notification_logs
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  reminder_type   = 'ANNOUNCEMENT'
         AND  status          = 'SUCCESS'
         AND  created_at     >= NOW() - INTERVAL '7 days'`,
      [studentId, organizationId]
    ),
  ]);

  return {
    recentNotifications:      notifResult.rows,
    last7DaysAnnouncements:   parseInt(announcementResult.rows[0].count, 10),
  };
}

// ============================================================
// RISK INSIGHTS
// All three signals computed in a single parallel Promise.all.
// ============================================================

async function fetchRiskInsights({ organizationId, studentId }) {
  const [attendanceResult, failedPaymentsResult, reminderResult] = await Promise.all([

    // Low attendance signal — reuse attendance aggregation
    pool.query(
      `SELECT
         COUNT(*)                                        AS total_days,
         COUNT(*) FILTER (WHERE status IN ('PRESENT','LATE')) AS effective_days
       FROM   attendance
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  deleted_at IS NULL`,
      [studentId, organizationId]
    ),

    // Frequent failed payments signal
    pool.query(
      `SELECT COUNT(*) AS failed_count
       FROM   payments
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  status          = 'FAILED'
         AND  deleted_at IS NULL`,
      [studentId, organizationId]
    ),

    // High reminder activity signal — FEE_REMINDER in last 30 days
    pool.query(
      `SELECT COUNT(*) AS reminder_count
       FROM   notification_logs
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  reminder_type   = 'FEE_REMINDER'
         AND  created_at     >= NOW() - INTERVAL '30 days'`,
      [studentId, organizationId]
    ),
  ]);

  const totalDays     = parseInt(attendanceResult.rows[0].total_days,    10);
  const effectiveDays = parseInt(attendanceResult.rows[0].effective_days, 10);
  const attendancePct = totalDays > 0 ? (effectiveDays / totalDays) * 100 : 100;

  const failedCount   = parseInt(failedPaymentsResult.rows[0].failed_count,  10);
  const reminderCount = parseInt(reminderResult.rows[0].reminder_count, 10);

  return {
    lowAttendance:          attendancePct < 75,
    frequentFailedPayments: failedCount   >= 3,
    highReminderActivity:   reminderCount >  5,
  };
}

// ============================================================
// MAIN — all queries in parallel after ownership guard
// ============================================================

async function getStudentProfile360({ organizationId, studentId }) {
  // Ownership guard runs first — throws 404 if student not found
  const basicInfo = await fetchBasicInfo({ organizationId, studentId });

  // All remaining aggregates run concurrently
  const [attendance, finance, paymentCounts, communication, riskInsights] = await Promise.all([
    fetchAttendanceSummary({ organizationId, studentId }),
    fetchFinanceSummary({ organizationId, studentId }),
    fetchPaymentCounts({ organizationId, studentId }),
    fetchCommunicationData({ organizationId, studentId }),
    fetchRiskInsights({ organizationId, studentId }),
  ]);

  return {
    basicInfo,
    attendanceSummary: attendance,
    finance,
    paymentSummary:    paymentCounts,
    communication,
    riskInsights,
  };
}

module.exports = { getStudentProfile360 };
