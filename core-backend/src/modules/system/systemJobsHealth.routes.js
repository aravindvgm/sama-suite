'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./systemJobsHealth.controller');

router.use(verifyToken);

router.get('/', requirePermission('system:read'), asyncHandler(controller.getJobsHealthStatus));

module.exports = router;
