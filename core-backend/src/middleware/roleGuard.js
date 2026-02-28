module.exports = (...allowedRoles) => {

  return (req, res, next) => {

    // safety check
    if (!req.user || !req.user.role) {

      return res.status(403).json({
        success: false,
        message: "Role missing from token"
      });

    }

    // normalize case
    const userRole = req.user.role.toLowerCase();

    const allowed = allowedRoles.map(r => r.toLowerCase());

    if (!allowed.includes(userRole)) {

      return res.status(403).json({
        success: false,
        message: "Access denied"
      });

    }

    next();

  };

};
