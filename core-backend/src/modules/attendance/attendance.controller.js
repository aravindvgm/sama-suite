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

// ============================================================
// GET SECTION ROSTER
// GET /api/:organizationId/attendance/section/:sectionId?date=YYYY-MM-DD
// ============================================================

async function getSectionRoster(req, res) {
  const { organizationId } = req.user;
  const { sectionId }      = req.params;
  const date               = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const data = await attendanceService.getSectionRoster({ organizationId, sectionId, date });
    return res.json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getSectionRoster error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// BULK MARK ATTENDANCE
// POST /api/:organizationId/attendance/bulk
// Body: { sectionId, date, records: [{ studentId, enrollmentId, status }] }
// ============================================================

async function bulkMarkAttendance(req, res) {
  const { organizationId, userId } = req.user;
  const { sectionId, date, records } = req.body;

  if (!sectionId || !date || !Array.isArray(records)) {
    return res.status(422).json({
      success: false,
      message: 'sectionId, date, and records[] are required',
    });
  }

  try {
    const result = await attendanceService.bulkUpsertAttendance({
      organizationId,
      sectionId,
      date,
      records,
      userId,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'BULK_MARK',
      entityType: 'ATTENDANCE',
      entityId:   sectionId,
      meta:       { date, count: result.saved },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, saved: result.saved });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('bulkMarkAttendance error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET STUDENT ATTENDANCE (parent view)
// GET /api/:organizationId/attendance/student/:studentId
// Returns last 7 days including today.
// ============================================================

async function getStudentAttendance(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const rows = await attendanceService.getStudentAttendanceSummary({ organizationId, studentId });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getStudentAttendance error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET ATTENDANCE DASHBOARD (principal)
// GET /api/:organizationId/attendance/dashboard?date=YYYY-MM-DD
// ============================================================

async function getDashboard(req, res) {
  const { organizationId } = req.user;
  const date               = req.query.date || new Date().toISOString().split('T')[0];

  try {
    const data = await attendanceService.getAttendanceDashboard({ organizationId, date });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getDashboard error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  markAttendance,
  getAttendanceByDate,
  updateAttendance,
  deleteAttendance,
  getSectionRoster,
  bulkMarkAttendance,
  getStudentAttendance,
  getDashboard,
};
