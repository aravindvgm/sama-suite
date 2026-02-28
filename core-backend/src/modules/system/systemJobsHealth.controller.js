'use strict';

const { getJobsHealth } = require('./systemJobsHealth.service');

async function getJobsHealthStatus(req, res) {
  try {
    const jobs = await getJobsHealth();
    return res.status(200).json({ success: true, data: jobs });
  } catch (err) {
    console.error('getJobsHealthStatus error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getJobsHealthStatus };
