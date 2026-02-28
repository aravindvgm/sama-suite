'use strict';

const { getFinanceDashboard } = require('./financeDashboard.service');

async function getFinanceDashboardSummary(req, res) {
  const { organizationId } = req.user;

  try {
    const data = await getFinanceDashboard({ organizationId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getFinanceDashboardSummary error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getFinanceDashboardSummary };
