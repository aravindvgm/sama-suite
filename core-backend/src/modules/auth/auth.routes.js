"use strict";

const express = require("express");

const authController = require("./auth.controller");

const router = express.Router({ mergeParams: true });

// Lightweight probe: GET /api/auth/health (confirms /api/auth mount in prod)
router.get("/health", (_req, res) => {
  res.json({
    success: true,
    scope: "auth",
    message: "AUTH_ROUTER_OK",
    timestamp: new Date().toISOString(),
  });
});

router.post(
  "/register",
  authController.register
);

router.post(
  "/login",
  authController.login
);

module.exports = router;