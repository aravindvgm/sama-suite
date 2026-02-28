'use strict';

const reportPdfService = require('./reportPdf.service');
const auditService     = require('../../utils/auditService');

async function generateReportCardPdf(req, res) {
  const { organizationId, userId } = req.user;
  const { studentId }              = req.params;

  try {
    const result = await reportPdfService.generateReportCardPdf({ organizationId, studentId });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'REPORT_CARD_PDF',
      entityId:   studentId,
      meta:       { generated_at: new Date().toISOString() },
      ipAddress:  req.ip,
    });

    return res.download(result.filePath, `report_card_${studentId}.pdf`, (err) => {
      if (err) {
        console.error('generateReportCardPdf download error:', err);
        if (!res.headersSent) {
          return res.status(500).json({ success: false, message: 'Failed to send report card file' });
        }
      }
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('generateReportCardPdf error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { generateReportCardPdf };
