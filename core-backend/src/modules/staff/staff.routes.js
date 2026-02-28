'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./staff.controller');

router.use(verifyToken);

router.post(  '/',    requirePermission('staff:create'), asyncHandler(controller.createStaff));
router.get(   '/',    requirePermission('staff:read'),   asyncHandler(controller.getStaff));
router.get(   '/:id', requirePermission('staff:read'),   asyncHandler(controller.getStaffById));
router.put(   '/:id', requirePermission('staff:update'), asyncHandler(controller.updateStaff));
router.delete('/:id', requirePermission('staff:delete'), asyncHandler(controller.deleteStaff));

module.exports = router;
