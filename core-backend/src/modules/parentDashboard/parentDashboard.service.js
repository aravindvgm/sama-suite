'use strict';

const pool                    = require('../../config/db');
const { getStudentReportCard } = require('../reports/report.service');

// ============================================================
// STUDENT PROFILE + ENROLLMENT
// ============================================================

async function fetchStudentProfile({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       s.id,
       s.first_name,
       s.last_name,
       se.academic_year,
       c.name   AS class_name,
       sec.name AS section_name
     FROM   students s
     LEFT   JOIN student_enrollments se
              ON se.student_id      = s.id
             AND se.organization_id = s.organization_id
             AND se.deleted_at IS NULL
     LEFT   JOIN classes  c   ON c.id   = se.class_id    AND c.deleted_at   IS NULL
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

  const row = rows[0];
  return {
    studentId:    row.id,
    fullName:     `${row.first_name} ${row.last_name}`.trim(),
    firstName:    row.first_name,
    lastName:     row.last_name,
    className:    row.class_name    || null,
    sectionName:  row.section_name  || null,
    academicYear: row.academic_year || null,
  };
}

// ============================================================
// FEE SUMMARY
// ============================================================

async function fetchFeeSummary({ organizationId, studentId }) {
  // Aggregate fee totals
  const { rows: totals } = await pool.query(
    `SELECT
       COALESCE(SUM(sf.amount), 0)                          AS total_fee_amount,
       MIN(sf.due_date) FILTER (WHERE sf.status != 'PAID')  AS next_due_date
     FROM   student_fees sf
     WHERE  sf.student_id      = $1
       AND  sf.organization_id = $2
       AND  sf.deleted_at IS NULL`,
    [studentId, organizationId]
  );

  // Total successfully paid across all fees
  const { rows: paidTotals } = await pool.query(
    `SELECT COALESCE(SUM(p.amount), 0) AS total_paid
     FROM   payments p
     WHERE  p.student_id      = $1
       AND  p.organization_id = $2
       AND  p.status          = 'SUCCESS'
       AND  p.deleted_at IS NULL`,
    [studentId, organizationId]
  );

  // Unpaid fees list
  const { rows: unpaidFees } = await pool.query(
    `SELECT
       sf.id,
       fs.fee_name,
       sf.amount         AS fee_amount,
       sf.due_date,
       sf.status,
       COALESCE(paid.total_paid, 0) AS paid_amount,
       sf.amount - COALESCE(paid.total_paid, 0) AS balance
     FROM   student_fees sf
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     LEFT   JOIN (
       SELECT student_fee_id, SUM(amount) AS total_paid
       FROM   payments
       WHERE  status          = 'SUCCESS'
         AND  organization_id = $2
         AND  deleted_at IS NULL
       GROUP  BY student_fee_id
     ) paid ON paid.student_fee_id = sf.id
     WHERE  sf.student_id      = $1
       AND  sf.organization_id = $2
       AND  sf.status         != 'PAID'
       AND  sf.deleted_at IS NULL
     ORDER  BY sf.due_date ASC`,
    [studentId, organizationId]
  );

  const totalFeeAmount = parseFloat(totals[0].total_fee_amount);
  const totalPaid      = parseFloat(paidTotals[0].total_paid);
  const totalBalance   = Math.max(0, totalFeeAmount - totalPaid);

  return {
    totalFeeAmount,
    totalPaidAmount: totalPaid,
    totalBalance,
    nextDueDate:     totals[0].next_due_date || null,
    unpaidFees:      unpaidFees.map((f) => ({
      feeId:      f.id,
      feeName:    f.fee_name,
      feeAmount:  parseFloat(f.fee_amount),
      paidAmount: parseFloat(f.paid_amount),
      balance:    parseFloat(f.balance),
      dueDate:    f.due_date,
      status:     f.status,
    })),
  };
}

// ============================================================
// PAYMENT HISTORY (last 5 SUCCESS)
// ============================================================

async function fetchPaymentHistory({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT
       p.id,
       p.amount,
       p.payment_method,
       p.gateway,
       p.gateway_payment_id,
       p.paid_at,
       fs.fee_name
     FROM   payments       p
     JOIN   student_fees   sf ON sf.id = p.student_fee_id   AND sf.deleted_at IS NULL
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     WHERE  p.student_id      = $1
       AND  p.organization_id = $2
       AND  p.status          = 'SUCCESS'
       AND  p.deleted_at IS NULL
     ORDER  BY p.paid_at DESC
     LIMIT  5`,
    [studentId, organizationId]
  );

  return rows.map((p) => ({
    paymentId:        p.id,
    feeName:          p.fee_name,
    amount:           parseFloat(p.amount),
    paymentMethod:    p.payment_method,
    gateway:          p.gateway,
    gatewayPaymentId: p.gateway_payment_id,
    paidAt:           p.paid_at,
  }));
}

// ============================================================
// ACADEMIC SUMMARY (from report service)
// ============================================================

async function fetchAcademicSummary({ organizationId, studentId }) {
  try {
    const report = await getStudentReportCard({ organizationId, studentId });
    return {
      overallPercentage: report.summary.overall_percentage,
      overallGrade:      report.summary.overall_grade,
      totalMarksObtained: report.summary.total_marks_obtained,
      totalMaxMarks:     report.summary.total_max_marks,
      examCount:         report.exams.length,
    };
  } catch {
    // No marks yet — return empty summary rather than error
    return {
      overallPercentage:  0,
      overallGrade:       null,
      totalMarksObtained: 0,
      totalMaxMarks:      0,
      examCount:          0,
    };
  }
}

// ============================================================
// CERTIFICATE COUNT
// ============================================================

async function fetchCertificateCount({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS total
     FROM   audit_logs
     WHERE  organization_id = $1
       AND  entity_id       = $2
       AND  entity_type     = 'STUDY_CERTIFICATE'
       AND  action          = 'CREATE'`,
    [organizationId, studentId]
  );
  return parseInt(rows[0].total, 10);
}

// ============================================================
// PARENT DASHBOARD — AGGREGATE
// ============================================================

async function getParentDashboard({ organizationId, studentId }) {
  const [
    studentProfile,
    feeSummary,
    paymentHistory,
    academicSummary,
    certificateCount,
  ] = await Promise.all([
    fetchStudentProfile({ organizationId, studentId }),
    fetchFeeSummary({ organizationId, studentId }),
    fetchPaymentHistory({ organizationId, studentId }),
    fetchAcademicSummary({ organizationId, studentId }),
    fetchCertificateCount({ organizationId, studentId }),
  ]);

  return {
    student:     studentProfile,
    fees:        feeSummary,
    payments:    paymentHistory,
    academics:   academicSummary,
    certificates: { totalGenerated: certificateCount },
  };
}

module.exports = { getParentDashboard };
