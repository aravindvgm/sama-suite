'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./reportPdf.controller');

router.use(verifyToken);

router.post('/pdf/:studentId', requirePermission('reports:create'), asyncHandler(controller.generateReportCardPdf));

module.exports = router;
