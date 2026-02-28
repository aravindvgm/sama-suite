// ======================================================
// authorizePlatformRoles — for platform-level roles.
// NOTE: platformRole is not currently encoded in the JWT by auth.service.js.
// This guard will always deny until platformRole is added to the token payload.
// ======================================================
function authorizePlatformRoles(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.platformRole;
    if (!role || !allowedRoles.map(r => r.toLowerCase()).includes(role.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: "Platform access denied",
      });
    }
    next();
  };
}

// ======================================================
// authorizeOrgRoles — for organization-level roles.
// auth.middleware.js sets req.user.role from the JWT claim.
// Case is normalized so "ORG_ADMIN" matches "org_admin" from the DB.
// ======================================================
function authorizeOrgRoles(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !allowedRoles.map(r => r.toLowerCase()).includes(role.toLowerCase())) {
      return res.status(403).json({
        success: false,
        message: "Organization access denied",
      });
    }
    next();
  };
}

module.exports = {
  authorizePlatformRoles,
  authorizeOrgRoles,
};
