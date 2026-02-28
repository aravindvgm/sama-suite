'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./notificationFailures.controller');

router.use(verifyToken);

router.get('/', requirePermission('notifications:manage'), asyncHandler(controller.getNotificationFailures));

module.exports = router;
