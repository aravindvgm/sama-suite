'use strict';

const express           = require('express');
const router            = express.Router({ mergeParams: true });
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./studentCommunicationTimeline.controller');

router.use(verifyToken);

router.get('/', requirePermission('students:read'), asyncHandler(controller.getCommunicationHistory));

module.exports = router;
