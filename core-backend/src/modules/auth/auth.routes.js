'use strict';

const express          = require('express');
const authController   = require('./auth.controller');
const loginRateLimiter = require('../../middleware/loginRateLimiter.middleware');

const router = express.Router({ mergeParams: true });

// REGISTER
router.post('/:organizationId/register', authController.register);

// LOGIN — layered rate limiting (IP / email-fail / IP+email combined)
router.post('/:organizationId/login', loginRateLimiter, authController.login);

module.exports = router;