const express = require("express");
const router = express.Router();

const meController = require("./me.controller");
const sessionService = require("../session/session.service");
const asyncHandler = require("../../utils/asyncHandler");

// ======================================================
// GET /api/users/me
// Returns the authenticated user's profile from the token.
// verifyToken is applied upstream in app.js — NOT repeated here.
// ======================================================

router.get("/me", asyncHandler(meController.getMe));

// ======================================================
// GET /api/users/me/organizations
// Returns all organizations the authenticated user belongs to.
// ======================================================

router.get(
  "/me/organizations",
  asyncHandler(async (req, res) => {
    const orgs = await sessionService.getUserOrganizations(req.user.userId);
    return res.status(200).json({ success: true, data: orgs });
  })
);

module.exports = router;
