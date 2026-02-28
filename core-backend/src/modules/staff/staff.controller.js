'use strict';

const staffService = require('./staff.service');
const auditService = require('../../utils/auditService');

// ============================================================
// CREATE
// ============================================================
async function createStaff(req, res) {
  const { organizationId, userId } = req.user;
  const { first_name, last_name }  = req.body;

  try {
    const record = await staffService.createStaff({ organizationId, userId, first_name, last_name });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'STAFF',
      entityId:   record.id,
      meta:       { first_name: record.first_name, last_name: record.last_name },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    console.error('createStaff error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// LIST (pagination + search)
// ============================================================
async function getStaff(req, res) {
  const { organizationId } = req.user;

  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const q     = (req.query.q || '').trim();

  try {
    const result = await staffService.getStaff({ organizationId, page, limit, q });

    return res.json({
      success: true,
      data:       result.rows,
      pagination: result.pagination,
    });
  } catch (err) {
    console.error('getStaff error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET BY ID
// ============================================================
async function getStaffById(req, res) {
  const { organizationId } = req.user;
  const { id }             = req.params;

  try {
    const record = await staffService.getStaffById({ organizationId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('getStaffById error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE
// ============================================================
async function updateStaff(req, res) {
  const { organizationId } = req.user;
  const { id }             = req.params;
  const { first_name, last_name } = req.body;

  try {
    const record = await staffService.updateStaff({ organizationId, id, first_name, last_name });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    auditService.log({
      organizationId,
      userId:     req.user.userId,
      action:     'UPDATE',
      entityType: 'STAFF',
      entityId:   record.id,
      meta:       { first_name: record.first_name, last_name: record.last_name },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    console.error('updateStaff error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// SOFT DELETE
// ============================================================
async function deleteStaff(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const record = await staffService.deleteStaff({ organizationId, userId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Staff member not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'STAFF',
      entityId:   record.id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Staff member deleted successfully' });
  } catch (err) {
    console.error('deleteStaff error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  createStaff,
  getStaff,
  getStaffById,
  updateStaff,
  deleteStaff,
};
