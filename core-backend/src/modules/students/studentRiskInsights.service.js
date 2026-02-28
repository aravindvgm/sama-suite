'use strict';

const pool = require('../../config/db');

// ============================================================
// RISK THRESHOLDS
// ============================================================

const ATTENDANCE_THRESHOLD_PCT  = 75;   // below → risk
const FAILED_PAYMENTS_THRESHOLD = 3;    // >= → risk
const FAILED_NOTIF_THRESHOLD    = 3;    // >= in last 7 days → risk
const OVERDUE_DAYS_THRESHOLD    = 30;   // days past due_date → risk

// Score: each of the 4 binary factors contributes 25 points (0–100)
// Level: 0–25 = LOW | 50 = MEDIUM | 75–100 = HIGH

// ============================================================
// OWNERSHIP GUARD
// ============================================================

async function assertStudentOwnership({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT id FROM students
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
}

// ============================================================
// MAIN
// ============================================================

async function getStudentRiskInsights({ organizationId, studentId }) {
  await assertStudentOwnership({ organizationId, studentId });

  // All 4 signal queries run concurrently
  const [
    attendanceResult,
    feeResult,
    failedPaymentsResult,
    failedNotifResult,
  ] = await Promise.all([

    // Signal 1 — Attendance: effective days / total days
    pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE')) AS effective,
         COUNT(*)                                               AS total
       FROM   attendance
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  deleted_at IS NULL`,
      [studentId, organizationId]
    ),

    // Signal 2 — Fee risk: pending balance + overdue count in one pass
    // Overdue = due_date is more than N days in the past AND not yet paid
    pool.query(
      `SELECT
         COALESCE(
           SUM(sf.amount) - COALESCE(SUM(paid.total_paid), 0),
           0
         )                                                       AS pending_balance,
         COUNT(*) FILTER (
           WHERE sf.due_date < CURRENT_DATE - INTERVAL '${OVERDUE_DAYS_THRESHOLD} days'
             AND sf.status   != 'PAID'
         )                                                       AS overdue_count
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
         AND  sf.status         != 'PAID'
         AND  sf.deleted_at IS NULL`,
      [studentId, organizationId]
    ),

    // Signal 3 — Payment failure count (all time)
    pool.query(
      `SELECT COUNT(*) AS failed_count
       FROM   payments
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  status          = 'FAILED'
         AND  deleted_at IS NULL`,
      [studentId, organizationId]
    ),

    // Signal 4 — Failed notifications in the last 7 days
    pool.query(
      `SELECT COUNT(*) AS failed_notif_count
       FROM   notification_logs
       WHERE  student_id      = $1
         AND  organization_id = $2
         AND  status          = 'FAILED'
         AND  created_at     >= NOW() - INTERVAL '7 days'`,
      [studentId, organizationId]
    ),
  ]);

  // ── Signal 1: attendance ──────────────────────────────────
  const totalDays     = parseInt(attendanceResult.rows[0].total,     10);
  const effectiveDays = parseInt(attendanceResult.rows[0].effective,  10);
  // No records = assume 100% (no risk data) rather than flagging falsely
  const attendancePct = totalDays > 0
    ? parseFloat(((effectiveDays / totalDays) * 100).toFixed(1))
    : 100;
  const attendanceRisk = attendancePct < ATTENDANCE_THRESHOLD_PCT;

  // ── Signal 2: fee ─────────────────────────────────────────
  const pendingBalance = parseFloat(feeResult.rows[0].pending_balance);
  const overdueCount   = parseInt(feeResult.rows[0].overdue_count, 10);
  // Both conditions must hold: money owed AND at least one fee is >30 days overdue
  const feeRisk = pendingBalance > 0 && overdueCount > 0;

  // ── Signal 3: payment failures ───────────────────────────
  const failedPaymentsCount = parseInt(failedPaymentsResult.rows[0].failed_count, 10);
  const paymentFailureRisk  = failedPaymentsCount >= FAILED_PAYMENTS_THRESHOLD;

  // ── Signal 4: communication ──────────────────────────────
  const failedNotifsLast7Days = parseInt(failedNotifResult.rows[0].failed_notif_count, 10);
  const communicationRisk     = failedNotifsLast7Days >= FAILED_NOTIF_THRESHOLD;

  // ── Composite score ──────────────────────────────────────
  const triggeredCount = [attendanceRisk, feeRisk, paymentFailureRisk, communicationRisk]
    .filter(Boolean).length;
  const riskScore = triggeredCount * 25;

  let riskLevel;
  if      (riskScore <= 25) riskLevel = 'LOW';
  else if (riskScore === 50) riskLevel = 'MEDIUM';
  else                       riskLevel = 'HIGH';

  return {
    riskScore,
    riskLevel,
    signals: {
      attendanceRisk: {
        triggered:             attendanceRisk,
        attendancePercentage:  attendancePct,
        threshold:             ATTENDANCE_THRESHOLD_PCT,
      },
      feeRisk: {
        triggered:      feeRisk,
        pendingBalance,
        overdueCount,
        overdueDaysThreshold: OVERDUE_DAYS_THRESHOLD,
      },
      paymentFailureRisk: {
        triggered:          paymentFailureRisk,
        failedPaymentsCount,
        threshold:          FAILED_PAYMENTS_THRESHOLD,
      },
      communicationRisk: {
        triggered:             communicationRisk,
        failedNotifsLast7Days,
        threshold:             FAILED_NOTIF_THRESHOLD,
      },
    },
  };
}

module.exports = { getStudentRiskInsights };
