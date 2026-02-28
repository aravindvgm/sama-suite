'use strict';

const { getStudentEarlyWarning } = require('./studentEarlyWarning.service');

async function getEarlyWarning(req, res) {
  const { organizationId } = req.user;

  try {
    const data = await getStudentEarlyWarning({ organizationId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getEarlyWarning error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getEarlyWarning };
