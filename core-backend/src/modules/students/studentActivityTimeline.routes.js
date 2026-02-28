'use strict';

const express           = require('express');
const router            = express.Router({ mergeParams: true });
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./studentActivityTimeline.controller');

router.use(verifyToken);

router.get('/:studentId/activity', requirePermission('students:read'), asyncHandler(controller.getActivityTimeline));

module.exports = router;
