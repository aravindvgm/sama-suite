'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./certificate.controller');

router.use(verifyToken);

router.post('/study/:studentId', requirePermission('certificates:create'), asyncHandler(controller.generateStudyCertificate));

module.exports = router;
