'use strict';

const certificateService = require('./certificate.service');
const auditService       = require('../../utils/auditService');

async function generateStudyCertificate(req, res) {
  const { organizationId, userId } = req.user;
  const { studentId }              = req.params;

  try {
    const result = await certificateService.generateStudyCertificate({ organizationId, studentId });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'STUDY_CERTIFICATE',
      entityId:   studentId,
      meta:       {
        student_name:  result.studentName,
        class_name:    result.className,
        section_name:  result.sectionName,
        academic_year: result.academicYear,
        issued_date:   result.issuedDate,
      },
      ipAddress: req.ip,
    });

    return res.download(result.filePath, `study_certificate_${studentId}.pdf`, (err) => {
      if (err) {
        console.error('generateStudyCertificate download error:', err);
        if (!res.headersSent) {
          return res.status(500).json({ success: false, message: 'Failed to send certificate file' });
        }
      }
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('generateStudyCertificate error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { generateStudyCertificate };
