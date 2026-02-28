'use strict';

const express             = require('express');
const router              = express.Router();
const asyncHandler        = require('../../utils/asyncHandler');
const linkController      = require('./paymentLinkPublic.controller');
const checkoutController  = require('./paymentCheckoutPublic.controller');

// Public — no verifyToken middleware
router.get('/link/:token', asyncHandler(linkController.getPaymentLinkCheckout));
router.post('/confirm',    asyncHandler(checkoutController.confirmPaymentCheckout));

module.exports = router;
