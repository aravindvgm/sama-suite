'use strict';

const reportService = require('./report.service');

async function getStudentReportCard(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const reportCard = await reportService.getStudentReportCard({ organizationId, studentId });
    return res.json({ success: true, data: reportCard });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getStudentReportCard error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getStudentReportCard };
