'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./adminOverviewDashboard.controller');

router.use(verifyToken);

// GET /admin/overview
router.get('/overview', requirePermission('dashboard:read'), asyncHandler(controller.getOverview));

module.exports = router;
