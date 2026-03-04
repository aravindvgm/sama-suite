"use strict";

const pool = require("../../config/db");
const { invalidateRolePermissionCache } = require("../auth/permission.service");

/**
 * POST /admin/roles/:roleId/permissions
 *
 * Grants a permission to a role within the organization.
 * Invalidates cached permission sets for all active members of that role.
 *
 * Body: { permissionId: string }
 */
async function grantPermission(req, res, next) {
  const { roleId }         = req.params;
  const { permissionId }   = req.body;
  const { organizationId } = req.user;

  try {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id, organization_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [roleId, permissionId, organizationId]
    );

    await invalidateRolePermissionCache(roleId, organizationId);

    return res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /admin/roles/:roleId/permissions/:permissionId
 *
 * Revokes a permission from a role within the organization.
 * Invalidates cached permission sets for all active members of that role.
 */
async function revokePermission(req, res, next) {
  const { roleId, permissionId } = req.params;
  const { organizationId }       = req.user;

  try {
    await pool.query(
      `DELETE FROM role_permissions
       WHERE  role_id         = $1
         AND  permission_id   = $2
         AND  organization_id = $3`,
      [roleId, permissionId, organizationId]
    );

    await invalidateRolePermissionCache(roleId, organizationId);

    return res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { grantPermission, revokePermission };
