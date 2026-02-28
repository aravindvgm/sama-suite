'use strict';

const { getCommunicationTimeline } = require('./studentCommunicationTimeline.service');

async function getCommunicationHistory(req, res) {
  const { organizationId }  = req.user;
  const { studentId }       = req.params;
  const { page, limit }     = req.query;

  try {
    const result = await getCommunicationTimeline({
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
    console.error('getCommunicationHistory error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getCommunicationHistory };
