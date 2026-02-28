'use strict';

const attendanceService = require('./attendance.service');
const auditService      = require('../../utils/auditService');

// ============================================================
// MARK ATTENDANCE
// ============================================================

async function markAttendance(req, res) {
  const { organizationId, userId }                    = req.user;
  const { enrollmentId, studentId, attendanceDate, status } = req.body;

  try {
    const record = await attendanceService.markAttendance({
      organizationId,
      userId,
      enrollmentId,
      studentId,
      attendanceDate,
      status,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'ATTENDANCE',
      entityId:   record.id,
      meta:       {
        student_id:      record.student_id,
        enrollment_id:   record.enrollment_id,
        attendance_date: record.attendance_date,
        status:          record.status,
      },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('markAttendance error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET ATTENDANCE BY DATE
// ============================================================

async function getAttendanceByDate(req, res) {
  const { organizationId } = req.user;
  const { date }           = req.query;

  try {
    const rows = await attendanceService.getAttendanceByDate({ organizationId, date });
    return res.json({ success: true, data: rows });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getAttendanceByDate error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE ATTENDANCE
// ============================================================

async function updateAttendance(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;
  const { status }                 = req.body;

  try {
    const record = await attendanceService.updateAttendance({ organizationId, id, status });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'UPDATE',
      entityType: 'ATTENDANCE',
      entityId:   record.id,
      meta:       {
        attendance_date: record.attendance_date,
        status:          record.status,
      },
      ipAddress: req.ip,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('updateAttendance error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// DELETE ATTENDANCE (soft)
// ============================================================

async function deleteAttendance(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const record = await attendanceService.deleteAttendance({ organizationId, userId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Attendance record not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'ATTENDANCE',
      entityId:   record.id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Attendance record deleted successfully' });
  } catch (err) {
    console.error('deleteAttendance error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  markAttendance,
  getAttendanceByDate,
  updateAttendance,
  deleteAttendance,
};
