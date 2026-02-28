'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./assistantConversation.controller');

router.use(verifyToken);

// GET /ai/assistant/history
router.get('/assistant/history', requirePermission('dashboard:read'), asyncHandler(controller.getHistory));

module.exports = router;
