'use strict';

const pool               = require('../../config/db');
const { generatePdf }    = require('../../utils/pdf.service');

// ============================================================
// DATA FETCHERS
// ============================================================

async function fetchCertificateData({ organizationId, studentId }) {
  // Student
  const { rows: studentRows } = await pool.query(
    `SELECT id, first_name, last_name
     FROM   students
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );
  if (studentRows.length === 0) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }

  // Active enrollment with class + section
  const { rows: enrollmentRows } = await pool.query(
    `SELECT
       se.id            AS enrollment_id,
       se.academic_year,
       c.name           AS class_name,
       s.name           AS section_name
     FROM   student_enrollments se
     JOIN   classes  c  ON c.id  = se.class_id   AND c.deleted_at  IS NULL
     LEFT   JOIN sections s ON s.id = se.section_id AND s.deleted_at IS NULL
     WHERE  se.student_id      = $1
       AND  se.organization_id = $2
       AND  se.deleted_at IS NULL
     ORDER  BY se.created_at DESC
     LIMIT  1`,
    [studentId, organizationId]
  );
  if (enrollmentRows.length === 0) {
    const err = new Error('No active enrollment found for this student');
    err.statusCode = 404;
    throw err;
  }

  // Organization details + branding assets
  const { rows: orgRows } = await pool.query(
    `SELECT name, logo_path, signature_path, stamp_path
     FROM   organizations
     WHERE  id = $1`,
    [organizationId]
  );

  const student    = studentRows[0];
  const enrollment = enrollmentRows[0];
  const org        = orgRows[0] || {};

  return { student, enrollment, org };
}

// ============================================================
// HTML TEMPLATE
// ============================================================

function buildCertificateHtml({ studentName, className, sectionName, academicYear, orgName, issuedDate }) {
  return `
  <style>
    .certificate-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 600px;
      padding: 40px 48px;
      text-align: center;
    }
    .cert-title {
      font-size: 26px;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: #1a3c6e;
      margin-bottom: 8px;
    }
    .cert-subtitle {
      font-size: 13px;
      color: #666;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 48px;
    }
    .cert-divider {
      width: 80px;
      border: none;
      border-top: 3px double #1a3c6e;
      margin: 0 auto 40px;
    }
    .cert-body {
      font-size: 15px;
      line-height: 2;
      color: #222;
      max-width: 560px;
      margin: 0 auto 40px;
    }
    .cert-body strong {
      color: #1a3c6e;
      font-size: 17px;
    }
    .cert-date {
      font-size: 12px;
      color: #888;
      margin-top: 32px;
    }
    .cert-border {
      border: 3px double #1a3c6e;
      padding: 32px;
      width: 100%;
      border-radius: 4px;
    }
  </style>

  <div class="certificate-wrapper">
    <div class="cert-border">
      <div class="cert-title">Study Certificate</div>
      <div class="cert-subtitle">Bonafide Certificate</div>
      <hr class="cert-divider" />
      <div class="cert-body">
        This is to certify that
        <strong>${studentName}</strong>
        is a bonafide student of
        <strong>${orgName}</strong>
        studying in
        <strong>Class ${className}${sectionName ? ' — Section ' + sectionName : ''}</strong>
        during the academic year
        <strong>${academicYear}</strong>.
        <br /><br />
        This certificate is issued for the purpose of identification and bonafide verification.
      </div>
      <div class="cert-date">Date of Issue: ${issuedDate}</div>
    </div>
  </div>
  `;
}

// ============================================================
// GENERATE STUDY CERTIFICATE
// ============================================================

async function generateStudyCertificate({ organizationId, studentId }) {
  const { student, enrollment, org } = await fetchCertificateData({ organizationId, studentId });

  const studentName  = `${student.first_name} ${student.last_name}`;
  const issuedDate   = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  const htmlContent  = buildCertificateHtml({
    studentName,
    className:    enrollment.class_name,
    sectionName:  enrollment.section_name || null,
    academicYear: enrollment.academic_year,
    orgName:      org.name || 'the Institution',
    issuedDate,
  });

  const outputFileName = `study_cert_${studentId}_${Date.now()}`;

  const result = await generatePdf({
    htmlContent,
    organizationLogo: org.logo_path      || null,
    signatureImage:   org.signature_path || null,
    stampImage:       org.stamp_path     || null,
    outputFileName,
  });

  if (!result.success) {
    const err = new Error(`PDF generation failed: ${result.error}`);
    err.statusCode = 500;
    throw err;
  }

  return {
    filePath:     result.filePath,
    studentName,
    className:    enrollment.class_name,
    sectionName:  enrollment.section_name,
    academicYear: enrollment.academic_year,
    issuedDate,
  };
}

module.exports = { generateStudyCertificate };
