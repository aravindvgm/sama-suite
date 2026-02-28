'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./paymentReceipt.controller');

router.use(verifyToken);

router.post('/:paymentId/receipt', requirePermission('payments:read'), asyncHandler(controller.generatePaymentReceipt));

module.exports = router;
