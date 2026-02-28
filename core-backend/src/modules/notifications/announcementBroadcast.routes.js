'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./announcementBroadcast.controller');

router.use(verifyToken);

router.post('/', requirePermission('notifications:manage'), asyncHandler(controller.sendAnnouncement));

module.exports = router;
