'use strict';

const { getStudentRiskInsights } = require('./studentRiskInsights.service');

async function getRiskInsights(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const data = await getStudentRiskInsights({ organizationId, studentId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getRiskInsights error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getRiskInsights };
