'use strict';

const parentDashboardService = require('./parentDashboard.service');

async function getParentDashboard(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const dashboard = await parentDashboardService.getParentDashboard({ organizationId, studentId });
    return res.json({ success: true, data: dashboard });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getParentDashboard error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getParentDashboard };
