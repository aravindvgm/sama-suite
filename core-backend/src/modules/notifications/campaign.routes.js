'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./campaign.controller');

router.use(verifyToken);

// POST /notifications/campaigns
router.post('/campaigns', requirePermission('notifications:send'), asyncHandler(controller.sendCampaign));

module.exports = router;
