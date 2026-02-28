'use strict';

const express           = require('express');
const router            = express.Router({ mergeParams: true });
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./studentOverview.controller');

router.use(verifyToken);

// GET /students/:studentId/overview
router.get('/:studentId/overview', requirePermission('students:read'), asyncHandler(controller.getOverview));

module.exports = router;
