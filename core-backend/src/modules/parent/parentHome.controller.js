'use strict';

const { getParentHome } = require('./parentHome.service');

async function getParentHomeSummary(req, res) {
  const { organizationId, userId } = req.user;

  try {
    const data = await getParentHome({ organizationId, userId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getParentHomeSummary error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getParentHomeSummary };
