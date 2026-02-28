const express = require("express");

const router = express.Router();


// =====================
// MODULE ROUTES
// =====================
const authRoutes =
require("../modules/auth/auth.routes");

const billingRoutes =
require("../modules/billing/billing.routes");

const meRoutes =
require("../modules/me/me.routes");

const sessionRoutes =
require("../modules/session/session.routes");

const usersRoutes =
require("../modules/users/users.routes");


// =====================
// REGISTER ROUTES
// =====================

// PUBLIC AUTH ROUTES
router.use("/auth", authRoutes);


// USER PROFILE
router.use("/me", meRoutes);


// SESSION
router.use("/session", sessionRoutes);


// BILLING (GLOBAL IF ANY)
router.use("/billing", billingRoutes);


// ORG BASE ROUTES
router.use("/org", usersRoutes);


module.exports = router;