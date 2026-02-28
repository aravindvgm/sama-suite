'use strict';

const examsService = require('./exams.service');
const auditService = require('../../utils/auditService');

// ============================================================
// CREATE EXAM
// ============================================================

async function createExam(req, res) {
  const { organizationId, userId }         = req.user;
  const { classId, examName, examDate }    = req.body;

  try {
    const record = await examsService.createExam({ organizationId, userId, classId, examName, examDate });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'EXAM',
      entityId:   record.id,
      meta:       { class_id: record.class_id, exam_name: record.exam_name, exam_date: record.exam_date },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('createExam error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// ADD STUDENT MARKS
// ============================================================

async function addStudentMarks(req, res) {
  const { organizationId, userId }                                         = req.user;
  const { studentId, enrollmentId, examId, subject, marks, maxMarks }     = req.body;

  try {
    const record = await examsService.addStudentMarks({
      organizationId,
      userId,
      studentId,
      enrollmentId,
      examId,
      subject,
      marks,
      maxMarks,
    });

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'STUDENT_MARKS',
      entityId:   record.id,
      meta:       {
        student_id:    record.student_id,
        exam_id:       record.exam_id,
        subject:       record.subject,
        marks:         record.marks,
        max_marks:     record.max_marks,
      },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('addStudentMarks error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET STUDENT REPORT
// ============================================================

async function getStudentReport(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const rows = await examsService.getStudentReport({ organizationId, studentId });
    return res.json({ success: true, data: rows });
  } catch (err) {
    console.error('getStudentReport error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE MARKS
// ============================================================

async function updateMarks(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;
  const { marks, maxMarks }        = req.body;

  try {
    const record = await examsService.updateMarks({ organizationId, id, marks, maxMarks });

    auditService.log({
      organizationId,
      userId,
      action:     'UPDATE',
      entityType: 'STUDENT_MARKS',
      entityId:   record.id,
      meta:       { marks: record.marks, max_marks: record.max_marks, subject: record.subject },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, data: record });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('updateMarks error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// DELETE MARKS (soft)
// ============================================================

async function deleteMarks(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
    const record = await examsService.deleteMarks({ organizationId, userId, id });

    if (!record) {
      return res.status(404).json({ success: false, message: 'Marks record not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'STUDENT_MARKS',
      entityId:   record.id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Marks record deleted successfully' });
  } catch (err) {
    console.error('deleteMarks error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  createExam,
  addStudentMarks,
  getStudentReport,
  updateMarks,
  deleteMarks,
};
