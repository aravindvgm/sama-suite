'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./paymentOrder.controller');

router.use(verifyToken);

router.post('/order', requirePermission('payments:create'), asyncHandler(controller.createPaymentOrder));

module.exports = router;
