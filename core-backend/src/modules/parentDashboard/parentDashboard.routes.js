'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./parentDashboard.controller');

router.use(verifyToken);

router.get('/:studentId', requirePermission('parents:read'), asyncHandler(controller.getParentDashboard));

module.exports = router;
