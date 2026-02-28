'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./fees.controller');

router.use(verifyToken);

router.post('/structure',           requirePermission('fees:create'), asyncHandler(controller.createFeeStructure));
router.post('/assign',              requirePermission('fees:create'), asyncHandler(controller.assignFeeToStudent));
router.get( '/student/:studentId',  requirePermission('fees:read'),   asyncHandler(controller.getStudentFees));
router.put( '/:id',                 requirePermission('fees:update'), asyncHandler(controller.updateFeeStatus));
router.delete('/:id',               requirePermission('fees:delete'), asyncHandler(controller.deleteFee));

module.exports = router;
