'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./paymentReconcile.controller');

router.use(verifyToken);

router.post('/:gatewayOrderId', requirePermission('payments:update'), asyncHandler(controller.reconcilePaymentByOrderId));

module.exports = router;
