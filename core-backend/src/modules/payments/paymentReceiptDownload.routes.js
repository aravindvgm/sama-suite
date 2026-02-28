'use strict';

const express           = require('express');
const router            = express.Router({ mergeParams: true });
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./paymentReceiptDownload.controller');

router.use(verifyToken);

router.get('/:paymentId/receipt', requirePermission('payments:read'), asyncHandler(controller.downloadPaymentReceipt));

module.exports = router;
