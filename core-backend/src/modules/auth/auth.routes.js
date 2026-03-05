'use strict';

const express          = require('express');
const authController   = require('./auth.controller');
const loginRateLimiter = require('../../middleware/loginRateLimiter.middleware');
const verifyToken      = require('../../middleware/auth.middleware');

const router = express.Router({ mergeParams: true });

// REGISTER
router.post('/:organizationId/register', authController.register);

// LOGIN — global identity model (no organizationId in URL; org resolved via memberships)
router.post('/login', loginRateLimiter, authController.login);

// LOGIN — legacy org-scoped URL kept for backward compatibility
router.post('/:organizationId/login', loginRateLimiter, authController.login);

// REFRESH — reads HttpOnly cookie; no JWT required (token may be expired)
// Cookie is scoped to this path so it is only sent on refresh requests.
router.post('/refresh', authController.refresh);

// LOGOUT — revokes the single session bound to the current cookie
router.post('/logout', authController.logout);

// LOGOUT ALL — revokes every session for the authenticated user
router.post('/logout-all', verifyToken, authController.logoutAll);

module.exports = router;