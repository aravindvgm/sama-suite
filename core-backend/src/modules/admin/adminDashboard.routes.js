"use strict";

const express = require("express");
const verifyToken = require("../../middleware/auth.middleware");
const { requireRole } = require("../../middleware/role.middleware");

const router = express.Router();

// GET /api/admin/dashboard
router.get(
  "/dashboard",
  verifyToken,
  requireRole(["admin"]),
  (_req, res) => {
    return res.json({
      success: true,
      message: "Admin access granted"
    });
  }
);

module.exports = router;

