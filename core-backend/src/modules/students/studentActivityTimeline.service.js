'use strict';

const pool = require('../../config/db');

// ============================================================
// OWNERSHIP GUARD
// ============================================================

async function assertStudentOwnership({ organizationId, studentId }) {
  const { rows } = await pool.query(
    `SELECT id FROM students
     WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [studentId, organizationId]
  );
  if (rows.length === 0) {
    const err = new Error('Student not found');
    err.statusCode = 404;
    throw err;
  }
}

// ============================================================
// DATA FETCHERS  (each returns a normalized event array)
// Fetch window = offset + limit so in-memory merge has enough rows.
// ============================================================

async function fetchCommunicationEvents({ organizationId, studentId, window }) {
  const { rows } = await pool.query(
    `SELECT reminder_type, status, contact_number, message, created_at
     FROM   notification_logs
     WHERE  student_id      = $1
       AND  organization_id = $2
     ORDER  BY created_at DESC
     LIMIT  $3`,
    [studentId, organizationId, window]
  );

  return rows.map((r) => ({
    type:          'COMMUNICATION',
    timestamp:     r.created_at,
    reminderType:  r.reminder_type,
    status:        r.status,
    contactNumber: r.contact_number,
    message:       r.message,
  }));
}

async function fetchPaymentEvents({ organizationId, studentId, window }) {
  const { rows } = await pool.query(
    `SELECT amount, status, gateway, paid_at, created_at
     FROM   payments
     WHERE  student_id      = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL
     ORDER  BY created_at DESC
     LIMIT  $3`,
    [studentId, organizationId, window]
  );

  return rows.map((r) => ({
    type:      'PAYMENT',
    timestamp: r.paid_at || r.created_at,
    amount:    parseFloat(r.amount),
    status:    r.status,
    gateway:   r.gateway || null,
    paidAt:    r.paid_at || null,
  }));
}

async function fetchAuditEvents({ organizationId, studentId, window }) {
  const { rows } = await pool.query(
    `SELECT action, entity_type, new_state, ip_address, changed_at
     FROM   audit_logs
     WHERE  entity_id       = $1
       AND  organization_id = $2
     ORDER  BY changed_at DESC
     LIMIT  $3`,
    [studentId, organizationId, window]
  );

  return rows.map((r) => ({
    type:       'AUDIT',
    timestamp:  r.changed_at,
    action:     r.action,
    entityType: r.entity_type,
    meta:       r.new_state || null,
    ipAddress:  r.ip_address || null,
  }));
}

// ============================================================
// MERGE + SORT + PAGINATE
// ============================================================

function mergeAndPaginate(arrays, page, limit) {
  const merged = [].concat(...arrays);

  merged.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const total      = merged.length;
  const totalPages = Math.ceil(total / limit);
  const offset     = (page - 1) * limit;
  const rows       = merged.slice(offset, offset + limit);

  return { rows, pagination: { page, limit, total, totalPages } };
}

// ============================================================
// MAIN
// ============================================================

async function getStudentActivityTimeline({ organizationId, studentId, page, limit }) {
  const safePage  = Math.max(1, page  || 1);
  const safeLimit = Math.min(100, Math.max(1, limit || 20));

  // Fetch enough rows from each source to cover the requested page
  const window = (safePage * safeLimit) + safeLimit;

  await assertStudentOwnership({ organizationId, studentId });

  const [communications, payments, audits] = await Promise.all([
    fetchCommunicationEvents({ organizationId, studentId, window }),
    fetchPaymentEvents({ organizationId, studentId, window }),
    fetchAuditEvents({ organizationId, studentId, window }),
  ]);

  return mergeAndPaginate([communications, payments, audits], safePage, safeLimit);
}

module.exports = { getStudentActivityTimeline };
