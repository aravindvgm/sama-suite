'use strict';

const enrollmentsService = require('./enrollments.service');
const auditService       = require('../../utils/auditService');

// ============================================================
// ENROLL STUDENT
// ============================================================

async function enrollStudent(req, res) {
  const { organizationId, userId }                           = req.user;
  const { studentId, classId, sectionId, academicYear } = req.body;

  try {
    const record = await enrollmentsService.enrollStudent({
      organizationId,
      userId,
      studentId,
      classId,
      sectionId,
      academicYear,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'ENROLLMENT',
      entityId:   record.id,
      meta:       { studentId, classId, sectionId, academicYear },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('enrollStudent error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET ENROLLMENTS BY STUDENT
// ============================================================

async function getStudentEnrollment(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const rows = await enrollmentsService.getStudentEnrollment({ organizationId, studentId });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getStudentEnrollment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE ENROLLMENT
// ============================================================

async function updateEnrollment(req, res) {
  const { organizationId, userId }            = req.user;
  const { id }                                = req.params;
  const { classId, sectionId, academicYear }  = req.body;

  try {
    const record = await enrollmentsService.updateEnrollment({
      organizationId,
      userId,
      id,
      classId,
      sectionId,
      academicYear,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'UPDATE',
      entityType: 'ENROLLMENT',
      entityId:   record.id,
      meta:       {
        class_id:      record.class_id,
        section_id:    record.section_id,
        academic_year: record.academic_year,
      },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('updateEnrollment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// DELETE ENROLLMENT (soft)
// ============================================================

async function deleteEnrollment(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const record = await enrollmentsService.deleteEnrollment({ organizationId, userId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Enrollment not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'ENROLLMENT',
      entityId:   record.id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Enrollment deleted successfully' });
  } catch (err) {
    console.error('deleteEnrollment error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  enrollStudent,
  getStudentEnrollment,
  updateEnrollment,
  deleteEnrollment,
};
