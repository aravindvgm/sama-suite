'use strict';

const service      = require('./notificationTemplate.service');
const auditService = require('../../utils/auditService');

// ============================================================
// CREATE
// ============================================================

async function createTemplate(req, res) {
  const { organizationId, userId }                         = req.user;
  const { name, type, messageTemplate, sendTo }            = req.body;

  if (!name || !type || !messageTemplate) {
    return res.status(400).json({
      success: false,
      message: 'name, type, and messageTemplate are required',
    });
  }

  try {
    const template = await service.createTemplate({
      organizationId,
      userId,
      name,
      type,
      messageTemplate,
      sendTo,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'NOTIFICATION_TEMPLATE',
      entityId:   template.id,
      meta:       { name: template.name, type: template.type, send_to: template.send_to },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: template });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('createTemplate error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// LIST
// ============================================================

async function getTemplates(req, res) {
  const { organizationId }  = req.user;
  const { type, page, limit } = req.query;

  try {
    const result = await service.getTemplates({
      organizationId,
      type:  type  || null,
      page:  parseInt(page,  10) || 1,
      limit: parseInt(limit, 10) || 20,
    });

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getTemplates error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE
// ============================================================

async function updateTemplate(req, res) {
  const { organizationId, userId }                              = req.user;
  const { id }                                                  = req.params;
  const { name, type, messageTemplate, sendTo }                 = req.body;

  try {
    const template = await service.updateTemplate({
      organizationId,
      id,
      name,
      type,
      messageTemplate,
      sendTo,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'UPDATE',
      entityType: 'NOTIFICATION_TEMPLATE',
      entityId:   template.id,
      meta:       { name: template.name, type: template.type, send_to: template.send_to },
      ipAddress:  req.ip,
    });

    return res.status(200).json({ success: true, data: template });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('updateTemplate error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// DELETE
// ============================================================

async function deleteTemplate(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const result = await service.deleteTemplate({ organizationId, id });

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'NOTIFICATION_TEMPLATE',
      entityId:   id,
      meta:       { deleted: true },
      ipAddress:  req.ip,
    });

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('deleteTemplate error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { createTemplate, getTemplates, updateTemplate, deleteTemplate };
