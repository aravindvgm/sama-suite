'use strict';

const pool = require('../config/db');

/**
 * requirePermission(permissionCode)
 *
 * Verifies the authenticated user holds the given permission
 * within their organization before allowing the request through.
 *
 * Usage:
 *   router.post('/students', verifyToken, requirePermission('students:create'), handler);
 *
 * @param {string} permissionCode  - e.g. "students:create"
 */
function requirePermission(permissionCode) {
  const [module, action] = permissionCode.split(':');

  if (!module || !action) {
    throw new Error(
      `requirePermission: invalid permissionCode "${permissionCode}". Expected "module:action".`
    );
  }

  return async function permissionGuard(req, res, next) {
    const userId         = req.user?.userId;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    try {
      const { rows } = await pool.query(
        `SELECT 1
         FROM   user_memberships  um
         JOIN   roles             r   ON r.id  = um.role_id
                                     AND r.organization_id = um.organization_id
         JOIN   role_permissions  rp  ON rp.role_id        = r.id
                                     AND rp.organization_id = um.organization_id
         JOIN   permissions       p   ON p.id  = rp.permission_id
         WHERE  um.user_id        = $1
           AND  um.organization_id = $2
           AND  p.module          = $3
           AND  p.action          = $4
         LIMIT  1`,
        [userId, organizationId, module, action]
      );

      if (rows.length === 0) {
        return res.status(403).json({ error: 'permission_denied' });
      }

      next();
    } catch (err) {
      console.error(`requirePermission("${permissionCode}") DB error:`, err);
      return res.status(500).json({ error: 'internal_server_error' });
    }
  };
}

module.exports = requirePermission;
