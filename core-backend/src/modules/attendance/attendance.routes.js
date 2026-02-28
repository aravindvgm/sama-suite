'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./attendance.controller');

router.use(verifyToken);

router.post(  '/',    requirePermission('attendance:create'), asyncHandler(controller.markAttendance));
router.get(   '/',    requirePermission('attendance:read'),   asyncHandler(controller.getAttendanceByDate));
router.put(   '/:id', requirePermission('attendance:update'), asyncHandler(controller.updateAttendance));
router.delete('/:id', requirePermission('attendance:delete'), asyncHandler(controller.deleteAttendance));

module.exports = router;
