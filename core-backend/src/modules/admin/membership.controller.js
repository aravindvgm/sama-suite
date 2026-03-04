"use strict";

const pool = require("../../config/db");
const { invalidateUserPermissionCache } = require("../auth/permission.service");

/**
 * PATCH /admin/organizations/:organizationId/memberships/:userId
 *
 * Updates a user's role or membership status within the organization.
 * Invalidates the user's cached permission set so the next request
 * loads fresh permissions from the database.
 *
 * Body: { roleId?: string, status?: string }
 */
async function updateMembership(req, res, next) {
  const { organizationId, userId } = req.params;
  const { roleId, status }         = req.body;

  try {
    await pool.query(
      `UPDATE user_memberships
       SET    role_id   = COALESCE($1, role_id),
              status    = COALESCE($2, status)
       WHERE  user_id         = $3
         AND  organization_id = $4`,
      [roleId ?? null, status ?? null, userId, organizationId]
    );

    invalidateUserPermissionCache(userId, organizationId);

    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { updateMembership };
