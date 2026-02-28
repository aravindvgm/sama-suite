'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./payments.controller');

router.use(verifyToken);

router.post('/',                   requirePermission('payments:create'), asyncHandler(controller.createPayment));
router.put( '/:id/status',         requirePermission('payments:update'), asyncHandler(controller.updatePaymentStatus));
router.get( '/student/:studentId', requirePermission('payments:read'),   asyncHandler(controller.getStudentPayments));

module.exports = router;
