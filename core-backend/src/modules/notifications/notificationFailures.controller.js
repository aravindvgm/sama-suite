'use strict';

const { getFailures } = require('./notificationFailures.service');

async function getNotificationFailures(req, res) {
  const { organizationId }             = req.user;
  const { date, reminder_type, page, limit } = req.query;

  try {
    const result = await getFailures({
      organizationId,
      date:         date         || null,
      reminderType: reminder_type || null,
      page:         parseInt(page,  10) || 1,
      limit:        parseInt(limit, 10) || 20,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getNotificationFailures error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getNotificationFailures };
