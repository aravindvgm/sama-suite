'use strict';

const classesService = require('./classes.service');
const auditService   = require('../../utils/auditService');

// ============================================================
// CLASSES
// ============================================================

async function createClass(req, res) {
  const { organizationId, userId } = req.user;
  const { name } = req.body;

  try {
    const record = await classesService.createClass({ organizationId, userId, name });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'CLASS',
      entityId:   record.id,
      meta:       { name: record.name },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error('createClass error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getClasses(req, res) {
  const { organizationId } = req.user;

  try {
    const rows = await classesService.getClasses({ organizationId });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getClasses error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function updateClass(req, res) {
  const { organizationId } = req.user;
  const { id }             = req.params;
  const { name }           = req.body;

  try {
    const record = await classesService.updateClass({ organizationId, id, name });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    auditService.log({
      organizationId,
      userId:     req.user.userId,
      action:     'UPDATE',
      entityType: 'CLASS',
      entityId:   record.id,
      meta:       { name: record.name },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('updateClass error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function deleteClass(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const record = await classesService.deleteClass({ organizationId, userId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'CLASS',
      entityId:   record.id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Class deleted successfully' });
  } catch (err) {
    console.error('deleteClass error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// SECTIONS
// ============================================================

async function createSection(req, res) {
  const { organizationId, userId } = req.user;
  const { classId }                = req.params;
  const { name }                   = req.body;

  try {
    const record = await classesService.createSection({ organizationId, userId, classId, name });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'SECTION',
      entityId:   record.id,
      meta:       { class_id: classId, name: record.name },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error('createSection error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function getSectionsByClass(req, res) {
  const { organizationId } = req.user;
  const { classId }        = req.params;

  try {
    const rows = await classesService.getSectionsByClass({ organizationId, classId });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getSectionsByClass error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function updateSection(req, res) {
  const { organizationId } = req.user;
  const { id }             = req.params;
  const { name }           = req.body;

  try {
    const record = await classesService.updateSection({ organizationId, id, name });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Section not found' });
    }

    auditService.log({
      organizationId,
      userId:     req.user.userId,
      action:     'UPDATE',
      entityType: 'SECTION',
      entityId:   record.id,
      meta:       { name: record.name },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('updateSection error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

async function deleteSection(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const record = await classesService.deleteSection({ organizationId, userId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Section not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'SECTION',
      entityId:   record.id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Section deleted successfully' });
  } catch (err) {
    console.error('deleteSection error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  createClass,
  getClasses,
  updateClass,
  deleteClass,
  createSection,
  getSectionsByClass,
  updateSection,
  deleteSection,
};
