'use strict';

const { AuthError }         = require('../modules/auth/auth.service');
const { userHasPermission } = require('../modules/auth/permission.service');

/**
 * requirePermission(permissionKey)
 *
 * Factory that returns an Express middleware which verifies the authenticated
 * user holds the given permission within their organization.
 *
 * Delegates to permission.service.js (cached, tenant-scoped).
 * Forwards all errors to next() — does NOT write JSON responses directly.
 *
 * Usage:
 *   router.delete('/students/:id', requirePermission('students:delete'), handler);
 *
 * @param {string} permissionKey  e.g. "students:delete"
 */
function requirePermission(permissionKey) {
  return async function permissionGuard(req, _res, next) {
    const userId         = req.user?.userId;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      const err  = new AuthError('UNAUTHENTICATED');
      err.status = 401;
      return next(err);
    }

    try {
      const allowed = await userHasPermission(userId, organizationId, permissionKey);

      if (!allowed) {
        const err  = new AuthError('FORBIDDEN');
        err.status = 403;
        return next(err);
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission };
