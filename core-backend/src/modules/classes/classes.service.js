'use strict';

const pool = require('../../config/db');

// ============================================================
// CLASSES
// ============================================================

async function createClass({ organizationId, userId, name }) {
  const { rows } = await pool.query(
    `INSERT INTO classes (organization_id, name, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, organization_id, name, created_by, created_at`,
    [organizationId, name, userId]
  );
  return rows[0];
}

async function getClasses({ organizationId }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, name, created_by, created_at, updated_at
     FROM   classes
     WHERE  organization_id = $1
       AND  deleted_at IS NULL
     ORDER  BY name ASC`,
    [organizationId]
  );
  return rows;
}

async function getClassById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, name, created_by, created_at, updated_at
     FROM   classes
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

async function updateClass({ organizationId, id, name }) {
  const { rows } = await pool.query(
    `UPDATE classes
     SET    name       = COALESCE($1, name),
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL
     RETURNING id, organization_id, name, created_by, created_at, updated_at`,
    [name ?? null, id, organizationId]
  );
  return rows[0] || null;
}

async function deleteClass({ organizationId, userId, id }) {
  const { rows } = await pool.query(
    `UPDATE classes
     SET    deleted_at = CURRENT_TIMESTAMP,
            deleted_by = $1,
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL
     RETURNING id`,
    [userId, id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// SECTIONS
// ============================================================

async function createSection({ organizationId, userId, classId, name }) {
  const { rows } = await pool.query(
    `INSERT INTO sections (organization_id, class_id, name, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, organization_id, class_id, name, created_by, created_at`,
    [organizationId, classId, name, userId]
  );
  return rows[0];
}

async function getSectionsByClass({ organizationId, classId }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, class_id, name, created_by, created_at, updated_at
     FROM   sections
     WHERE  organization_id = $1
       AND  class_id        = $2
       AND  deleted_at IS NULL
     ORDER  BY name ASC`,
    [organizationId, classId]
  );
  return rows;
}

async function getSectionById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, class_id, name, created_by, created_at, updated_at
     FROM   sections
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

async function updateSection({ organizationId, id, name }) {
  const { rows } = await pool.query(
    `UPDATE sections
     SET    name       = COALESCE($1, name),
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL
     RETURNING id, organization_id, class_id, name, created_by, created_at, updated_at`,
    [name ?? null, id, organizationId]
  );
  return rows[0] || null;
}

async function deleteSection({ organizationId, userId, id }) {
  const { rows } = await pool.query(
    `UPDATE sections
     SET    deleted_at = CURRENT_TIMESTAMP,
            deleted_by = $1,
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $2
       AND  organization_id = $3
       AND  deleted_at IS NULL
     RETURNING id`,
    [userId, id, organizationId]
  );
  return rows[0] || null;
}

module.exports = {
  createClass,
  getClasses,
  getClassById,
  updateClass,
  deleteClass,
  createSection,
  getSectionsByClass,
  getSectionById,
  updateSection,
  deleteSection,
};
