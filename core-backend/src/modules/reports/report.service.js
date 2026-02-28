'use strict';

const pool = require('../../config/db');

// ============================================================
// GRADE CALCULATOR
// ============================================================

function calculateGrade(percentage) {
  if (percentage >= 90) return 'A+';
  if (percentage >= 75) return 'A';
  if (percentage >= 60) return 'B';
  if (percentage >= 50) return 'C';
  return 'F';
}

// ============================================================
// GET STUDENT REPORT CARD
// ============================================================

async function getStudentReportCard({ organizationId, studentId }) {
  // 1. Student basic details
  const { rows: studentRows } = await pool.query(
    `SELECT id, first_name, last_name, created_at
     FROM   students
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentId, organizationId]
  );

  if (studentRows.length === 0) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }

  const student = studentRows[0];

  // 2. Active enrollment with class and section
  const { rows: enrollmentRows } = await pool.query(
    `SELECT
       se.id              AS enrollment_id,
       se.academic_year,
       c.id               AS class_id,
       c.name             AS class_name,
       s.id               AS section_id,
       s.name             AS section_name
     FROM   student_enrollments se
     JOIN   classes  c ON c.id  = se.class_id   AND c.deleted_at  IS NULL
     LEFT   JOIN sections s ON s.id = se.section_id AND s.deleted_at IS NULL
     WHERE  se.student_id      = $1
       AND  se.organization_id = $2
       AND  se.deleted_at IS NULL
     ORDER  BY se.created_at DESC
     LIMIT  1`,
    [studentId, organizationId]
  );

  const enrollment = enrollmentRows[0] || null;

  // 3. All exam marks for this student
  const { rows: marksRows } = await pool.query(
    `SELECT
       sm.id,
       sm.subject,
       sm.marks,
       sm.max_marks,
       e.id        AS exam_id,
       e.exam_name,
       e.exam_date
     FROM   student_marks sm
     JOIN   exams e ON e.id = sm.exam_id AND e.deleted_at IS NULL
     WHERE  sm.student_id      = $1
       AND  sm.organization_id = $2
       AND  sm.deleted_at IS NULL
     ORDER  BY e.exam_date ASC, sm.subject ASC`,
    [studentId, organizationId]
  );

  // 4. Group marks by exam
  const examsMap = {};
  let totalMarksObtained = 0;
  let totalMaxMarks      = 0;

  for (const row of marksRows) {
    if (!examsMap[row.exam_id]) {
      examsMap[row.exam_id] = {
        exam_id:   row.exam_id,
        exam_name: row.exam_name,
        exam_date: row.exam_date,
        subjects:  [],
        exam_total_marks:     0,
        exam_total_max_marks: 0,
      };
    }

    const pct  = row.max_marks > 0 ? parseFloat(((row.marks / row.max_marks) * 100).toFixed(2)) : 0;

    examsMap[row.exam_id].subjects.push({
      subject:    row.subject,
      marks:      parseFloat(row.marks),
      max_marks:  parseFloat(row.max_marks),
      percentage: pct,
      grade:      calculateGrade(pct),
    });

    examsMap[row.exam_id].exam_total_marks     += parseFloat(row.marks);
    examsMap[row.exam_id].exam_total_max_marks += parseFloat(row.max_marks);

    totalMarksObtained += parseFloat(row.marks);
    totalMaxMarks      += parseFloat(row.max_marks);
  }

  // Attach per-exam percentage and grade
  const exams = Object.values(examsMap).map((exam) => {
    const examPct = exam.exam_total_max_marks > 0
      ? parseFloat(((exam.exam_total_marks / exam.exam_total_max_marks) * 100).toFixed(2))
      : 0;
    return {
      ...exam,
      exam_percentage: examPct,
      exam_grade:      calculateGrade(examPct),
    };
  });

  // 5. Overall summary
  const overallPercentage = totalMaxMarks > 0
    ? parseFloat(((totalMarksObtained / totalMaxMarks) * 100).toFixed(2))
    : 0;

  return {
    student: {
      id:         student.id,
      first_name: student.first_name,
      last_name:  student.last_name,
    },
    enrollment: enrollment
      ? {
          enrollment_id: enrollment.enrollment_id,
          academic_year: enrollment.academic_year,
          class_id:      enrollment.class_id,
          class_name:    enrollment.class_name,
          section_id:    enrollment.section_id,
          section_name:  enrollment.section_name,
        }
      : null,
    exams,
    summary: {
      total_marks_obtained: totalMarksObtained,
      total_max_marks:      totalMaxMarks,
      overall_percentage:   overallPercentage,
      overall_grade:        calculateGrade(overallPercentage),
    },
  };
}

module.exports = { getStudentReportCard };
