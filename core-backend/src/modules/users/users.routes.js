const express = require("express");
const router = express.Router();
const asyncHandler = require("../../utils/asyncHandler");

// organization.middleware reads req.params.organizationId.
// The route param MUST be :organizationId to match — not :orgId.
const orgGuard = require("../../middleware/organization.middleware");
const { requireOrganization } = require("../../middleware/org.middleware");
const orgContextController = require("./orgContext.controller");

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

// GET /api/org/dashboard
// Reads org from x-org-id header (or :organizationId param if present)
router.get("/dashboard", requireOrganization(), (req, res) => {
  return res.json({
    success: true,
    organizationId: req.organization.id,
    userRole: req.organization.role
  });
});

// POST /api/org/set-active
router.post(
  "/set-active",
  asyncHandler(orgContextController.setActiveOrganization)
);

// GET /api/org/my-orgs
router.get(
  "/my-orgs",
  asyncHandler(orgContextController.getMyOrganizations)
);

module.exports = router;
