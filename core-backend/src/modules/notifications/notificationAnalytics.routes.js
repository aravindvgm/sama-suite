'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./notificationAnalytics.controller');

router.use(verifyToken);

router.get('/summary', requirePermission('notifications:manage'), asyncHandler(controller.getAnalyticsSummary));

module.exports = router;
