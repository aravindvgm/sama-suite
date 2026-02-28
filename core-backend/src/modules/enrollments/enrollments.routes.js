'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./enrollments.controller');

router.use(verifyToken);

router.post(  '/',             requirePermission('enrollments:create'), asyncHandler(controller.enrollStudent));
router.get(   '/:studentId',   requirePermission('enrollments:read'),   asyncHandler(controller.getStudentEnrollment));
router.put(   '/:id',          requirePermission('enrollments:update'), asyncHandler(controller.updateEnrollment));
router.delete('/:id',          requirePermission('enrollments:delete'), asyncHandler(controller.deleteEnrollment));

module.exports = router;
