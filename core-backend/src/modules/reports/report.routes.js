'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./report.controller');

router.use(verifyToken);

router.get('/student/:studentId', requirePermission('reports:read'), asyncHandler(controller.getStudentReportCard));

module.exports = router;
