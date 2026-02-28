'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./parentHome.controller');

router.use(verifyToken);

router.get('/home', requirePermission('parents:read'), asyncHandler(controller.getParentHomeSummary));

module.exports = router;
