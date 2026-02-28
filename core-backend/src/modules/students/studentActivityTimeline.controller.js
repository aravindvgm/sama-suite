'use strict';

const { getStudentActivityTimeline } = require('./studentActivityTimeline.service');

async function getActivityTimeline(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;
  const { page, limit }    = req.query;

  try {
    const result = await getStudentActivityTimeline({
      organizationId,
      studentId,
      page:  parseInt(page,  10) || 1,
      limit: parseInt(limit, 10) || 20,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getActivityTimeline error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getActivityTimeline };
