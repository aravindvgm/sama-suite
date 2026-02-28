'use strict';

const pool = require('../../config/db');

// ============================================================
// CREATE
// ============================================================
async function createStudent({ organizationId, userId, first_name, last_name }) {
  const { rows } = await pool.query(
    `INSERT INTO students (organization_id, first_name, last_name, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, organization_id, first_name, last_name, created_by, created_at`,
    [organizationId, first_name, last_name, userId]
  );
  return rows[0];
}

// ============================================================
// LIST (pagination + search)
// ============================================================
async function getStudents({ organizationId, page, limit, q }) {
  const safePage   = Math.max(1, page);
  const safeLimit  = Math.min(100, Math.max(1, limit));
  const offset     = (safePage - 1) * safeLimit;
  const searchTerm = q ? `%${q}%` : null;

  const searchClause = searchTerm
    ? `AND (first_name ILIKE $4 OR last_name ILIKE $4 OR CONCAT(first_name,' ',last_name) ILIKE $4)`
    : '';

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, organization_id, first_name, last_name, created_by, created_at, updated_at
       FROM   students
       WHERE  organization_id = $1
         AND  deleted_at IS NULL
         ${searchClause}
       ORDER  BY created_at DESC
       LIMIT  $2 OFFSET $3`,
      searchTerm
        ? [organizationId, safeLimit, offset, searchTerm]
        : [organizationId, safeLimit, offset]
    ),
    pool.query(
      `SELECT COUNT(*) AS total
       FROM   students
       WHERE  organization_id = $1
         AND  deleted_at IS NULL
         ${searchClause}`,
      searchTerm
        ? [organizationId, searchTerm]
        : [organizationId]
    ),
  ]);

  const total      = parseInt(countResult.rows[0].total, 10);
  const totalPages = Math.ceil(total / safeLimit);

  return { rows: dataResult.rows, pagination: { page: safePage, limit: safeLimit, total, totalPages } };
}

// ============================================================
// GET BY ID
// ============================================================
async function getStudentById({ organizationId, id }) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, first_name, last_name, created_by, created_at, updated_at
     FROM   students
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// UPDATE
// ============================================================
async function updateStudent({ organizationId, id, first_name, last_name }) {
  const { rows } = await pool.query(
    `UPDATE students
     SET    first_name = COALESCE($1, first_name),
            last_name  = COALESCE($2, last_name),
            updated_at = CURRENT_TIMESTAMP
     WHERE  id              = $3
       AND  organization_id = $4
       AND  deleted_at IS NULL
     RETURNING id, organization_id, first_name, last_name, created_by, created_at, updated_at`,
    [first_name ?? null, last_name ?? null, id, organizationId]
  );
  return rows[0] || null;
}

// ============================================================
// SOFT DELETE
// ============================================================
async function deleteStudent({ organizationId, userId, id }) {
  const { rows } = await pool.query(
    `UPDATE students
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
  createStudent,
  getStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
};
