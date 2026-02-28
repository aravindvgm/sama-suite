const express = require("express");
const router = express.Router();

// organization.middleware reads req.params.organizationId.
// The route param MUST be :organizationId to match — not :orgId.
const orgGuard = require("../../middleware/organization.middleware");

// ======================================================
// ORG USER ROUTES
// Base path: /api/org
//
// verifyToken is applied upstream in app.js before this router.
// It must NOT be repeated here.
// ======================================================

// GET /api/org/:organizationId/users
router.get("/:organizationId/users", orgGuard, (req, res) => {
  res.json({
    success: true,
    message: "OrgGuard Working Successfully",
    organization: req.organization
  });
});

module.exports = router;
