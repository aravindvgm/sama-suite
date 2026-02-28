const rateLimit = require("express-rate-limit");

/*
========================================================
TENANT RATE LIMITER
- Prevents abuse per organization + IP
- IPv6 safe (express-rate-limit v7 requirement)
========================================================
*/

const tenantLimiter = rateLimit({

  windowMs: 15 * 60 * 1000, // 15 minutes

  max: 500, // requests per window

  standardHeaders: true,

  legacyHeaders: false,

  /*
  ========================================================
  ✅ SAFE KEY GENERATOR (IPv6 Compatible)
  ========================================================
  */

  keyGenerator: (req) => {

    // organization id from URL param
    const orgId =
      req.params.organizationId ||
      req.user?.organizationId ||
      "unknown-org";

    // SAFE IP provided by express-rate-limit helper
    const ip = rateLimit.ipKeyGenerator(req);

    return `${orgId}-${ip}`;
  },

});

module.exports = tenantLimiter;
