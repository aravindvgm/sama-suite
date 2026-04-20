const pool = require("../config/db");

function requireOrganization() {
  return async function requireOrganizationMiddleware(req, res, next) {
    try {
      const userId = req.user?.userId;
      let organizationId =
        req.headers["x-org-id"] ||
        req.params.organizationId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "UNAUTHORIZED"
        });
      }

      if (!organizationId) {
        const activeOrg = await pool.query(
          `SELECT active_organization_id
           FROM users
           WHERE id = $1
           LIMIT 1`,
          [userId]
        );

        organizationId = activeOrg.rows[0]?.active_organization_id || null;

        if (!organizationId) {
          return res.status(400).json({
            success: false,
            message: "ORGANIZATION_ID_REQUIRED"
          });
        }
      }

      const result = await pool.query(
        `SELECT organization_id, role
         FROM memberships
         WHERE user_id = $1
           AND organization_id = $2
         LIMIT 1`,
        [userId, organizationId]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "FORBIDDEN"
        });
      }

      req.organization = {
        id: organizationId,
        role: result.rows[0].role
      };

      return next();

    } catch (_err) {
      return res.status(403).json({
        success: false,
        message: "FORBIDDEN"
      });
    }
  };
}

module.exports = {
  requireOrganization
};

