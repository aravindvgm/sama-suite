'use strict';

const express           = require('express');
const router            = express.Router({ mergeParams: true });
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./studentProfile360.controller');

router.use(verifyToken);

router.get('/:studentId/profile', requirePermission('students:read'), asyncHandler(controller.getStudentProfile));

module.exports = router;
