'use strict';

const pool = require('../../config/db');

async function getFailures({ organizationId, date, reminderType, page, limit }) {
  const safePage  = Math.max(1, page  || 1);
  const safeLimit = Math.min(100, Math.max(1, limit || 20));
  const offset    = (safePage - 1) * safeLimit;

  const conditions = [`organization_id = $1`, `status = 'FAILED'`];
  const params     = [organizationId];
  let   idx        = 2;

  if (date) {
    conditions.push(`DATE(created_at) = $${idx++}`);
    params.push(date);
  }

  if (reminderType) {
    conditions.push(`reminder_type = $${idx++}`);
    params.push(reminderType.toUpperCase());
  }

  const where = conditions.join(' AND ');

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, student_id, contact_number, message, reminder_type,
              error_message, attempts, created_at
       FROM   notification_logs
       WHERE  ${where}
       ORDER  BY created_at DESC
       LIMIT  $${idx++} OFFSET $${idx++}`,
      [...params, safeLimit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM notification_logs WHERE ${where}`,
      params
    ),
  ]);

  const total      = parseInt(countResult.rows[0].total, 10);
  const totalPages = Math.ceil(total / safeLimit);

  return {
    rows:       dataResult.rows,
    pagination: { page: safePage, limit: safeLimit, total, totalPages },
  };
}

module.exports = { getFailures };
