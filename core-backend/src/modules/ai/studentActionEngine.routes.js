'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./studentActionEngine.controller');

router.use(verifyToken);

// GET /ai/student-actions
router.get('/student-actions', requirePermission('dashboard:read'), asyncHandler(controller.getStudentActionSuggestions));

module.exports = router;
