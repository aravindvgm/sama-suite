'use strict';

const express           = require('express');
const router            = express.Router({ mergeParams: true });
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./studentRiskInsights.controller');

router.use(verifyToken);

// GET /students/:studentId/risk-insights
router.get('/:studentId/risk-insights', requirePermission('students:read'), asyncHandler(controller.getRiskInsights));

module.exports = router;
