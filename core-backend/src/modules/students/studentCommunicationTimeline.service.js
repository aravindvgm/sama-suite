'use strict';

const pool = require('../../config/db');

async function getCommunicationTimeline({ organizationId, studentId, page, limit }) {
  const safePage  = Math.max(1, page  || 1);
  const safeLimit = Math.min(100, Math.max(1, limit || 20));
  const offset    = (safePage - 1) * safeLimit;

  // Confirm student belongs to org before returning any data
  const { rows: guard } = await pool.query(
    `SELECT id FROM students
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [studentId, organizationId]
  );

  if (guard.length === 0) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT reminder_type, contact_number, status, message,
              message_id, error_message, attempts, created_at
       FROM   notification_logs
       WHERE  student_id      = $1
         AND  organization_id = $2
       ORDER  BY created_at DESC
       LIMIT  $3 OFFSET $4`,
      [studentId, organizationId, safeLimit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) AS total
       FROM   notification_logs
       WHERE  student_id      = $1
         AND  organization_id = $2`,
      [studentId, organizationId]
    ),
  ]);

  const total      = parseInt(countResult.rows[0].total, 10);
  const totalPages = Math.ceil(total / safeLimit);

  return {
    rows:       dataResult.rows,
    pagination: { page: safePage, limit: safeLimit, total, totalPages },
  };
}

module.exports = { getCommunicationTimeline };
