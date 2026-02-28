'use strict';

const feesService  = require('./fees.service');
const auditService = require('../../utils/auditService');

// ============================================================
// CREATE FEE STRUCTURE
// ============================================================

async function createFeeStructure(req, res) {
  const { organizationId, userId }    = req.user;
  const { classId, feeName, amount }  = req.body;

  try {
    const record = await feesService.createFeeStructure({ organizationId, userId, classId, feeName, amount });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'FEE_STRUCTURE',
      entityId:   record.id,
      meta:       { class_id: record.class_id, fee_name: record.fee_name, amount: record.amount },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('createFeeStructure error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// ASSIGN FEE TO STUDENT
// ============================================================

async function assignFeeToStudent(req, res) {
  const { organizationId, userId }                                     = req.user;
  const { studentId, enrollmentId, feeStructureId, amount, dueDate }  = req.body;

  try {
    const record = await feesService.assignFeeToStudent({
      organizationId,
      userId,
      studentId,
      enrollmentId,
      feeStructureId,
      amount,
      dueDate,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'STUDENT_FEE',
      entityId:   record.id,
      meta:       {
        student_id:       record.student_id,
        enrollment_id:    record.enrollment_id,
        fee_structure_id: record.fee_structure_id,
        amount:           record.amount,
        due_date:         record.due_date,
      },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('assignFeeToStudent error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET STUDENT FEES
// ============================================================

async function getStudentFees(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const rows = await feesService.getStudentFees({ organizationId, studentId });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getStudentFees error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE FEE STATUS
// ============================================================

async function updateFeeStatus(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;
  const { status }                 = req.body;

  try {
    const record = await feesService.updateFeeStatus({ organizationId, id, status });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Fee record not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'UPDATE',
      entityType: 'STUDENT_FEE',
      entityId:   record.id,
      meta:       { status: record.status, amount: record.amount, due_date: record.due_date },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('updateFeeStatus error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// DELETE FEE (soft)
// ============================================================

async function deleteFee(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const record = await feesService.deleteFee({ organizationId, userId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Fee record not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'STUDENT_FEE',
      entityId:   record.id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Fee record deleted successfully' });
  } catch (err) {
    console.error('deleteFee error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  createFeeStructure,
  assignFeeToStudent,
  getStudentFees,
  updateFeeStatus,
  deleteFee,
};
