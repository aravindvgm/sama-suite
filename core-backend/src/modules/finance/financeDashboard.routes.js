'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./financeDashboard.controller');

router.use(verifyToken);

router.get('/dashboard', requirePermission('payments:read'), asyncHandler(controller.getFinanceDashboardSummary));

module.exports = router;
