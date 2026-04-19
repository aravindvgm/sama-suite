'use strict';

const express = require('express');
const authController = require('./auth.controller');
const loginRateLimiter = require('../../middleware/loginRateLimiter.middleware');
const verifyToken = require('../../middleware/auth.middleware');

const router = express.Router({ mergeParams: true });

/* -------------------------------------------------------------------------- */
/* REGISTER */
/* -------------------------------------------------------------------------- */

router.post(
  '/:organizationId/register',
  authController.register
);

/* -------------------------------------------------------------------------- */
/* LOGIN (Primary Route) */
/* Global login — organization resolved from memberships */
/* -------------------------------------------------------------------------- */

router.post(
  '/login',
  loginRateLimiter,
  authController.login
);

/* -------------------------------------------------------------------------- */
/* LOGIN (Legacy org scoped) */
/* Keeps backward compatibility with /:organizationId/login */
/* -------------------------------------------------------------------------- */

router.post(
  '/:organizationId/login',
  loginRateLimiter,
  authController.login
);

/* -------------------------------------------------------------------------- */
/* REFRESH TOKEN */
/* -------------------------------------------------------------------------- */

router.post(
  '/refresh',
  authController.refresh
);

/* -------------------------------------------------------------------------- */
/* LOGOUT CURRENT SESSION */
/* -------------------------------------------------------------------------- */

router.post(
  '/logout',
  authController.logout
);

/* -------------------------------------------------------------------------- */
/* LOGOUT ALL SESSIONS */
/* -------------------------------------------------------------------------- */

router.post(
  '/logout-all',
  verifyToken,
  authController.logoutAll
);

module.exports = router;