'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./studentEarlyWarning.controller');

router.use(verifyToken);

// GET /students/early-warning
// IMPORTANT: mount this router BEFORE any router that defines
// /:studentId/* on the same /students prefix, so Express matches
// the static segment 'early-warning' before the param wildcard.
router.get('/early-warning', requirePermission('dashboard:read'), asyncHandler(controller.getEarlyWarning));

module.exports = router;
