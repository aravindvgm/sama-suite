'use strict';

const { getSummary } = require('./notificationAnalytics.service');

async function getAnalyticsSummary(req, res) {
  const { organizationId } = req.user;

  try {
    const data = await getSummary({ organizationId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getAnalyticsSummary error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getAnalyticsSummary };
