const jwt = require("jsonwebtoken");

module.exports = function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "UNAUTHORIZED"
      });
    }

    const token = authHeader.split(" ")[1];
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) {
      console.error("JWT_SECRET missing");
      return res.status(500).json({
        success: false,
        message: "SERVER_MISCONFIGURATION"
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = {
      userId: decoded.sub
    };

    return next();

  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "UNAUTHORIZED"
    });
  }
};