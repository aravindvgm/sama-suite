const pool = require("../config/db");

function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [];
  const allowedLower = new Set(allowed.map((r) => String(r).toLowerCase()));

  return async function requireRoleMiddleware(req, res, next) {
    try {
      const membershipRole = req.organization?.role;

      if (membershipRole) {
        const role = String(membershipRole || "").toLowerCase();
        if (!allowedLower.has(role)) {
          return res.status(403).json({
            success: false,
            message: "FORBIDDEN"
          });
        }
        return next();
      }

      const userId = req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "UNAUTHORIZED"
        });
      }

      const result = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
      const role = String(result.rows[0]?.role || "").toLowerCase();

      if (!allowedLower.has(role)) {
        return res.status(403).json({
          success: false,
          message: "FORBIDDEN"
        });
      }

      return next();

    } catch (_err) {
      return res.status(403).json({
        success: false,
        message: "FORBIDDEN"
      });
    }
  };
}

// Backward-compatible aliases used by existing routes
function authorizeOrgRoles(...allowedRoles) {
  return requireRole(allowedRoles);
}

function authorizePlatformRoles(...allowedRoles) {
  return requireRole(allowedRoles);
}

module.exports = {
  requireRole,
  authorizeOrgRoles,
  authorizePlatformRoles
};
