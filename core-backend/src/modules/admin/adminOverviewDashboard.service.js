'use strict';

const pool = require('../../config/db');

// ============================================================
// ADMIN OVERVIEW DASHBOARD
// 5 parallel queries — all scoped to organizationId.
//
// Q1  attendance        → todayAttendancePercentage
// Q2  payments          → todayCollection + pendingReconcilePayments  (single pass)
// Q3  notification_logs → notificationsSentToday + failedNotificationsToday (single pass)
// Q4  student_fees      → pendingFeesCount
// Q5  students          → birthdayStudentsToday
// ============================================================

async function getAdminOverview({ organizationId }) {
  const [
    attendanceResult,
    paymentsResult,
    notifResult,
    pendingFeesResult,
    birthdayResult,
  ] = await Promise.all([

    // Q1 — Today's attendance (PRESENT + LATE = effective)
    // attendance_date is the dedicated date column on the attendance table.
    // No records today → percentage defaults to 100 (same as studentRiskInsights).
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE')) AS effective,
         COUNT(*)                                               AS total
       FROM   attendance
       WHERE  organization_id = $1
         AND  attendance_date = CURRENT_DATE
         AND  deleted_at IS NULL`,
      [organizationId]
    ),

    // Q2 — Today's collection + pending reconcile in a single scan.
    // Collection: payments created today with SUCCESS status.
    // Reconcile:  payments sitting in PENDING_RECONCILE state (any date).
    pool.query(
      `SELECT
         COALESCE(
           SUM(amount) FILTER (
             WHERE status     = 'SUCCESS'
               AND created_at >= CURRENT_DATE
           ), 0
         )          AS today_collection,
         COUNT(*) FILTER (WHERE status = 'PENDING_RECONCILE') AS pending_reconcile
       FROM   payments
       WHERE  organization_id = $1
         AND  deleted_at IS NULL`,
      [organizationId]
    ),

    // Q3 — Notifications sent/failed today in a single scan.
    // "Today" = created_at >= CURRENT_DATE (midnight boundary).
    // SENT  = successfully dispatched.
    // FAILED = delivery failure.
    pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE status     = 'SENT'
             AND created_at >= CURRENT_DATE
         ) AS sent_today,
         COUNT(*) FILTER (
           WHERE status     = 'FAILED'
             AND created_at >= CURRENT_DATE
         ) AS failed_today
       FROM   notification_logs
       WHERE  organization_id = $1`,
      [organizationId]
    ),

    // Q4 — Unpaid student fees
    pool.query(
      `SELECT COUNT(*) AS pending_fees_count
       FROM   student_fees
       WHERE  organization_id = $1
         AND  status         != 'PAID'
         AND  deleted_at IS NULL`,
      [organizationId]
    ),

    // Q5 — Students whose birthday is today (month + day match)
    pool.query(
      `SELECT COUNT(*) AS birthday_count
       FROM   students
       WHERE  organization_id = $1
         AND  EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND  EXTRACT(DAY   FROM date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)
         AND  deleted_at IS NULL`,
      [organizationId]
    ),
  ]);

  // Attendance percentage — defaults to 100 when no records exist for today
  // (no data = assume full attendance, avoids false dashboard alerts)
  const effective = parseInt(attendanceResult.rows[0].effective, 10);
  const total     = parseInt(attendanceResult.rows[0].total,     10);
  const todayAttendancePercentage = total > 0
    ? parseFloat(((effective / total) * 100).toFixed(1))
    : 100;

  const pRow = paymentsResult.rows[0];
  const nRow = notifResult.rows[0];

  return {
    todayAttendancePercentage,
    todayCollection:          parseFloat(pRow.today_collection),
    pendingFeesCount:         parseInt(pendingFeesResult.rows[0].pending_fees_count, 10),
    birthdayStudentsToday:    parseInt(birthdayResult.rows[0].birthday_count,        10),
    notificationsSentToday:   parseInt(nRow.sent_today,                              10),
    failedNotificationsToday: parseInt(nRow.failed_today,                            10),
    pendingReconcilePayments: parseInt(pRow.pending_reconcile,                       10),
  };
}

module.exports = { getAdminOverview };
