"use strict";

const express = require("express");

const authController = require("./auth.controller");
const loginRateLimiter = require("../../middleware/loginRateLimiter.middleware");
const verifyToken = require("../../middleware/auth.middleware");

const router = express.Router({ mergeParams: true });

/* -------------------------------------------------------------------------- */
/* HEALTH CHECK                                                               */
/* -------------------------------------------------------------------------- */

router.get("/health", (req, res) => {
  return res.json({ success: true, message: "Auth service running" });
});

/* -------------------------------------------------------------------------- */
/* REGISTER                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * ✅ SIMPLE REGISTER (NO ORG - USE THIS NOW)
 */
router.post(
  "/register",
  authController.register
);

/**
 * ⚠️ FUTURE: ORG-BASED REGISTER (KEEP FOR LATER)
 */
router.post(
  "/:organizationId/register",
  authController.register
);

/* -------------------------------------------------------------------------- */
/* LOGIN                                                                      */
/* -------------------------------------------------------------------------- */

router.post(
  "/login",
  loginRateLimiter,
  authController.login
);

/**
 * Optional legacy org login
 */
router.post(
  "/:organizationId/login",
  loginRateLimiter,
  authController.login
);

/* -------------------------------------------------------------------------- */
/* TOKEN                                                                      */
/* -------------------------------------------------------------------------- */

router.post("/refresh", authController.refresh);

/* -------------------------------------------------------------------------- */
/* LOGOUT                                                                     */
/* -------------------------------------------------------------------------- */

router.post("/logout", authController.logout);

router.post(
  "/logout-all",
  verifyToken,
  authController.logoutAll
);

/* -------------------------------------------------------------------------- */
/* CURRENT USER                                                               */
/* -------------------------------------------------------------------------- */

router.get(
  "/me",
  verifyToken,
  authController.me
);

module.exports = router;