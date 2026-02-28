'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./notificationRetryManual.controller');

router.use(verifyToken);

router.post('/:logId', requirePermission('notifications:manage'), asyncHandler(controller.retryNotification));

module.exports = router;
