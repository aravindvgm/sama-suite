'use strict';

const pool                    = require('../../config/db');
const { getStudentReportCard } = require('./report.service');
const { generatePdf }         = require('../../utils/pdf.service');

// ============================================================
// HELPERS
// ============================================================

function gradeColor(grade) {
  const map = { 'A+': '#1a6b2f', A: '#2e7d32', B: '#1565c0', C: '#e65100', F: '#b71c1c' };
  return map[grade] || '#333';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ============================================================
// HTML BUILDER
// ============================================================

function buildReportCardHtml({ report, orgName, issuedDate }) {
  const { student, enrollment, exams, summary } = report;

  const studentName  = `${student.first_name} ${student.last_name}`;
  const className    = enrollment?.class_name   || '—';
  const sectionName  = enrollment?.section_name || '—';
  const academicYear = enrollment?.academic_year || '—';

  // ── Exam tables ──
  const examTablesHtml = exams.length === 0
    ? `<p style="text-align:center;color:#888;padding:24px 0;">No exam records found.</p>`
    : exams.map((exam) => `
      <div class="exam-block">
        <div class="exam-header">
          <span class="exam-name">${exam.exam_name}</span>
          <span class="exam-date">${formatDate(exam.exam_date)}</span>
        </div>
        <table class="marks-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Marks Obtained</th>
              <th>Max Marks</th>
              <th>Percentage</th>
              <th>Grade</th>
            </tr>
          </thead>
          <tbody>
            ${exam.subjects.map((s) => `
            <tr>
              <td>${s.subject}</td>
              <td class="num">${s.marks}</td>
              <td class="num">${s.max_marks}</td>
              <td class="num">${s.percentage}%</td>
              <td class="grade" style="color:${gradeColor(s.grade)}">${s.grade}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr class="exam-total-row">
              <td><strong>Exam Total</strong></td>
              <td class="num"><strong>${exam.exam_total_marks}</strong></td>
              <td class="num"><strong>${exam.exam_total_max_marks}</strong></td>
              <td class="num"><strong>${exam.exam_percentage}%</strong></td>
              <td class="grade" style="color:${gradeColor(exam.exam_grade)}"><strong>${exam.exam_grade}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>`).join('');

  return `
  <style>
    /* ── Reset ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Page ── */
    .rc-page { padding: 0 8px 8px; font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; }

    /* ── Identity card ── */
    .identity-card {
      background: linear-gradient(135deg, #1a3c6e 0%, #2258a5 100%);
      color: #fff;
      border-radius: 8px;
      padding: 20px 28px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 22px;
    }
    .identity-card .student-name {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
    }
    .identity-card .info-row {
      font-size: 12px;
      opacity: 0.88;
      margin-bottom: 4px;
    }
    .identity-card .info-row span { font-weight: 600; }
    .identity-card .org-badge {
      text-align: right;
      font-size: 11px;
      opacity: 0.75;
    }
    .identity-card .org-badge .org-name { font-size: 14px; font-weight: 700; opacity: 1; margin-bottom: 4px; }

    /* ── Section heading ── */
    .section-heading {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #1a3c6e;
      border-left: 4px solid #1a3c6e;
      padding-left: 10px;
      margin: 18px 0 12px;
    }

    /* ── Exam block ── */
    .exam-block { margin-bottom: 20px; }
    .exam-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f0f4fb;
      border-left: 4px solid #2258a5;
      padding: 7px 12px;
      border-radius: 0 4px 4px 0;
      margin-bottom: 0;
    }
    .exam-name { font-weight: 700; font-size: 13px; color: #1a3c6e; }
    .exam-date { font-size: 11px; color: #666; }

    /* ── Marks table ── */
    .marks-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .marks-table thead tr {
      background: #1a3c6e;
      color: #fff;
    }
    .marks-table thead th {
      padding: 8px 10px;
      text-align: left;
      font-weight: 600;
      letter-spacing: 0.3px;
    }
    .marks-table tbody tr:nth-child(even) { background: #f7f9fc; }
    .marks-table tbody tr:hover          { background: #edf2fb; }
    .marks-table td { padding: 7px 10px; border-bottom: 1px solid #e8edf5; }
    .marks-table .num   { text-align: center; }
    .marks-table .grade { text-align: center; font-weight: 700; font-size: 13px; }
    .marks-table tfoot .exam-total-row td {
      background: #e8edf7;
      padding: 8px 10px;
      border-top: 2px solid #2258a5;
    }

    /* ── Overall summary ── */
    .summary-card {
      display: flex;
      gap: 12px;
      margin-top: 22px;
      margin-bottom: 8px;
    }
    .summary-item {
      flex: 1;
      background: #f0f4fb;
      border-radius: 8px;
      padding: 14px 16px;
      text-align: center;
      border-top: 3px solid #1a3c6e;
    }
    .summary-item .label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 6px; }
    .summary-item .value { font-size: 20px; font-weight: 700; color: #1a3c6e; }
    .summary-item .value.grade-val { font-size: 26px; }

    .issued-line {
      text-align: right;
      font-size: 10px;
      color: #aaa;
      margin-top: 10px;
    }
  </style>

  <div class="rc-page">

    <!-- Identity -->
    <div class="identity-card">
      <div>
        <div class="student-name">${studentName}</div>
        <div class="info-row">Class: <span>${className}</span></div>
        <div class="info-row">Section: <span>${sectionName}</span></div>
        <div class="info-row">Academic Year: <span>${academicYear}</span></div>
      </div>
      <div class="org-badge">
        <div class="org-name">${orgName}</div>
        <div>Report Card</div>
      </div>
    </div>

    <!-- Exam Marks -->
    <div class="section-heading">Examination Results</div>
    ${examTablesHtml}

    <!-- Overall Summary -->
    <div class="section-heading">Overall Performance</div>
    <div class="summary-card">
      <div class="summary-item">
        <div class="label">Marks Obtained</div>
        <div class="value">${summary.total_marks_obtained} / ${summary.total_max_marks}</div>
      </div>
      <div class="summary-item">
        <div class="label">Overall Percentage</div>
        <div class="value">${summary.overall_percentage}%</div>
      </div>
      <div class="summary-item">
        <div class="label">Overall Grade</div>
        <div class="value grade-val" style="color:${gradeColor(summary.overall_grade)}">${summary.overall_grade}</div>
      </div>
    </div>

    <div class="issued-line">Date of Issue: ${issuedDate}</div>
  </div>
  `;
}

// ============================================================
// GENERATE REPORT CARD PDF
// ============================================================

async function generateReportCardPdf({ organizationId, studentId }) {
  // Fetch report data via existing service
  const report = await getStudentReportCard({ organizationId, studentId });

  // Fetch org branding
  const { rows: orgRows } = await pool.query(
    `SELECT name, logo_path, signature_path, stamp_path
     FROM   organizations
     WHERE  id = $1`,
    [organizationId]
  );
  const org = orgRows[0] || {};

  const issuedDate  = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const htmlContent = buildReportCardHtml({ report, orgName: org.name || 'Institution', issuedDate });

  const outputFileName = `report_card_${studentId}_${Date.now()}`;

  const result = await generatePdf({
    htmlContent,
    organizationLogo: org.logo_path      || null,
    signatureImage:   org.signature_path || null,
    stampImage:       org.stamp_path     || null,
    watermarkText:    'OFFICIAL REPORT CARD',
    outputFileName,
  });

  if (!result.success) {
    const err = new Error(`PDF generation failed: ${result.error}`);
    err.statusCode = 500;
    throw err;
  }

  return { filePath: result.filePath, studentId };
}

module.exports = { generateReportCardPdf };
