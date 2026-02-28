'use strict';

const pool         = require('../../config/db');
const auditService = require('../../utils/auditService');

// ============================================================
// CREATE
// ============================================================
async function createStudent(req, res) {
  const { organizationId, userId } = req.user;
  const { first_name, last_name } = req.body;

  try {
    const { rows } = await pool.query(
      `INSERT INTO students (organization_id, first_name, last_name, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, organization_id, first_name, last_name, created_by, created_at`,
      [organizationId, first_name, last_name, userId]
    );

    auditService.log({
      organizationId,
      userId,
      action:     'CREATE',
      entityType: 'STUDENT',
      entityId:   rows[0].id,
      meta:       { first_name: rows[0].first_name, last_name: rows[0].last_name },
      ipAddress:  req.ip,
    });

    return res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('createStudent error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// LIST (pagination + search)
// ============================================================
async function getStudents(req, res) {
  const { organizationId } = req.user;

  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const q     = (req.query.q || '').trim();
  const offset = (page - 1) * limit;

  try {
    const searchClause = q
      ? `AND (first_name ILIKE $4 OR last_name ILIKE $4 OR CONCAT(first_name,' ',last_name) ILIKE $4)`
      : '';

    const params = q
      ? [organizationId, limit, offset, `%${q}%`]
      : [organizationId, limit, offset];

    const [dataResult, countResult] = await Promise.all([
      pool.query(
        `SELECT id, organization_id, first_name, last_name, created_by, created_at, updated_at
         FROM   students
         WHERE  organization_id = $1
           AND  deleted_at IS NULL
           ${searchClause}
         ORDER  BY created_at DESC
         LIMIT  $2 OFFSET $3`,
        params
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM   students
         WHERE  organization_id = $1
           AND  deleted_at IS NULL
           ${searchClause}`,
        q ? [organizationId, `%${q}%`] : [organizationId]
      ),
    ]);

    const total      = parseInt(countResult.rows[0].total, 10);
    const totalPages = Math.ceil(total / limit);

    return res.json({
      success: true,
      data: dataResult.rows,
      pagination: { page, limit, total, totalPages },
    });
  } catch (err) {
    console.error('getStudents error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// GET BY ID
// ============================================================
async function getStudentById(req, res) {
  const { organizationId } = req.user;
  const { id }             = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT id, organization_id, first_name, last_name, created_by, created_at, updated_at
       FROM   students
       WHERE  id              = $1
         AND  organization_id = $2
         AND  deleted_at IS NULL`,
      [id, organizationId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('getStudentById error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// UPDATE
// ============================================================
async function updateStudent(req, res) {
  const { organizationId } = req.user;
  const { id }             = req.params;
  const { first_name, last_name } = req.body;

  try {
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

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    auditService.log({
      organizationId,
      userId:     req.user.userId,
      action:     'UPDATE',
      entityType: 'STUDENT',
      entityId:   rows[0].id,
      meta:       { first_name: rows[0].first_name, last_name: rows[0].last_name },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('updateStudent error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ============================================================
// SOFT DELETE
// ============================================================
async function deleteStudent(req, res) {
  const { organizationId, userId } = req.user;
  const { id }                     = req.params;

  try {
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

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    auditService.log({
      organizationId,
      userId,
      action:     'DELETE',
      entityType: 'STUDENT',
      entityId:   rows[0].id,
      meta:       { deleted_by: userId },
      ipAddress:  req.ip,
    });

    return res.json({ success: true, message: 'Student deleted successfully' });
  } catch (err) {
    console.error('deleteStudent error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = {
  createStudent,
  getStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
};
