'use strict';

const { broadcastAnnouncement } = require('./announcementBroadcast.service');
const auditService               = require('../../utils/auditService');

async function sendAnnouncement(req, res) {
  const { organizationId, userId }           = req.user;
  const { title, filter, classId, sectionId, confirmationToken } = req.body;

  if (!title) {
    return res.status(400).json({ success: false, message: 'title is required' });
  }

  // Fetch org name for template rendering
  const pool = require('../../config/db');
  let organizationName = '';
  try {
    const { rows } = await pool.query(
      `SELECT name FROM organizations WHERE id = $1`,
      [organizationId]
    );
    organizationName = rows[0]?.name || '';
  } catch (_) {
    // Non-fatal — template will render with empty organizationName
  }

  let result;
  try {
    result = await broadcastAnnouncement({
      organizationId,
      organizationName,
      title,
      filter,
      classId:           classId           || null,
      sectionId:         sectionId         || null,
      confirmationToken: confirmationToken || null,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  // Batch exceeded thresholds — client must resend with CONFIRM_SEND token
  if (result.confirmationRequired) {
    return res.status(202).json({
      success:              true,
      confirmationRequired: true,
      message:              result.hint,
      data:                 result,
    });
  }

  auditService.log({
    organizationId,
    userId,
    action:     'BROADCAST',
    entityType: 'ANNOUNCEMENT',
    entityId:   organizationId,
    meta: {
      title,
      filter:          filter || 'ALL_STUDENTS',
      classId:         classId   || null,
      sectionId:       sectionId || null,
      recipientCount:  result.recipientCount,
      queued:          result.queued,
    },
    ipAddress: req.ip,
  });

  return res.status(202).json({
    success: true,
    message: result.queued
      ? `Announcement queued for ${result.recipientCount} contact(s)`
      : 'No contacts found for the selected filter',
    data: result,
  });
}

module.exports = { sendAnnouncement };
