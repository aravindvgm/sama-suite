'use strict';

const pool = require('../../config/db');

// ============================================================
// VALID TYPES
// ============================================================

const VALID_TYPES   = ['FEE_REMINDER', 'BIRTHDAY', 'ANNOUNCEMENT', 'INVITATION'];
const VALID_SEND_TO = ['WHATSAPP', 'SMS', 'EMAIL'];

function assertValidType(type) {
  if (!VALID_TYPES.includes(type)) {
    const err = new Error(`Invalid template type. Allowed: ${VALID_TYPES.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }
}

function assertValidSendTo(sendTo) {
  if (sendTo && !VALID_SEND_TO.includes(sendTo)) {
    const err = new Error(`Invalid send_to value. Allowed: ${VALID_SEND_TO.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }
}

// ============================================================
// CREATE
// ============================================================

async function createTemplate({ organizationId, userId, name, type, messageTemplate, sendTo }) {
  assertValidType(type);
  assertValidSendTo(sendTo);

  try {
    const { rows } = await pool.query(
      `INSERT INTO notification_templates
         (organization_id, name, type, message_template, send_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, organization_id, name, type, message_template, send_to,
                 created_by, created_at, updated_at`,
      [organizationId, name.trim(), type, messageTemplate.trim(), sendTo || 'WHATSAPP', userId]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error(`A template named "${name}" already exists in this organization`);
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

// ============================================================
// LIST (with optional type filter + pagination)
// ============================================================

async function getTemplates({ organizationId, type, page, limit }) {
  const safePage  = Math.max(1, page  || 1);
  const safeLimit = Math.min(100, Math.max(1, limit || 20));
  const offset    = (safePage - 1) * safeLimit;

  const typeClause  = type ? `AND type = $3` : '';
  const typeParams  = type ? [organizationId, safeLimit, type] : [organizationId, safeLimit];

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, organization_id, name, type, message_template, send_to,
              created_by, created_at, updated_at
       FROM   notification_templates
       WHERE  organization_id = $1
         AND  deleted_at IS NULL
         ${typeClause}
       ORDER  BY created_at DESC
       LIMIT  $2 OFFSET ${offset}`,
      typeParams
    ),
    pool.query(
      `SELECT COUNT(*) AS total
       FROM   notification_templates
       WHERE  organization_id = $1
         AND  deleted_at IS NULL
         ${typeClause}`,
      type ? [organizationId, type] : [organizationId]
    ),
  ]);

  const total      = parseInt(countResult.rows[0].total, 10);
  const totalPages = Math.ceil(total / safeLimit);

  return {
    rows:       dataResult.rows,
    pagination: { page: safePage, limit: safeLimit, total, totalPages },
  };
}

// ============================================================
// GET BY ID
// ============================================================

async function getTemplateById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, name, type, message_template, send_to,
            created_by, created_at, updated_at
     FROM   notification_templates
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('Notification template not found');
    err.statusCode = 404;
    throw err;
  }

  return rows[0];
}

// ============================================================
// UPDATE
// ============================================================

async function updateTemplate({ organizationId, id, name, type, messageTemplate, sendTo }) {
  // Confirm exists first
  await getTemplateById({ organizationId, id });

  if (type)    assertValidType(type);
  if (sendTo)  assertValidSendTo(sendTo);

  const fields  = [];
  const values  = [];
  let   paramIdx = 1;

  if (name            !== undefined) { fields.push(`name = $${paramIdx++}`);             values.push(name.trim()); }
  if (type            !== undefined) { fields.push(`type = $${paramIdx++}`);             values.push(type); }
  if (messageTemplate !== undefined) { fields.push(`message_template = $${paramIdx++}`); values.push(messageTemplate.trim()); }
  if (sendTo          !== undefined) { fields.push(`send_to = $${paramIdx++}`);          values.push(sendTo); }

  if (fields.length === 0) {
    const err = new Error('No fields provided for update');
    err.statusCode = 400;
    throw err;
  }

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id, organizationId);

  try {
    const { rows } = await pool.query(
      `UPDATE notification_templates
       SET    ${fields.join(', ')}
       WHERE  id              = $${paramIdx++}
         AND  organization_id = $${paramIdx++}
         AND  deleted_at IS NULL
       RETURNING id, organization_id, name, type, message_template, send_to,
                 created_by, created_at, updated_at`,
      values
    );

    if (rows.length === 0) {
      const err = new Error('Notification template not found');
      err.statusCode = 404;
      throw err;
    }

    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error(`A template named "${name}" already exists in this organization`);
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

// ============================================================
// SOFT DELETE
// ============================================================

async function deleteTemplate({ organizationId, id }) {
  const { rows } = await pool.query(
    `UPDATE notification_templates
     SET    deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL
     RETURNING id`,
    [id, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('Notification template not found');
    err.statusCode = 404;
    throw err;
  }

  return { deleted: true, id: rows[0].id };
}

module.exports = {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
};
