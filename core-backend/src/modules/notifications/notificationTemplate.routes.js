'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./notificationTemplate.controller');

router.use(verifyToken);
router.use(requirePermission('notifications:manage'));

router.post('/',    asyncHandler(controller.createTemplate));
router.get('/',     asyncHandler(controller.getTemplates));
router.put('/:id',  asyncHandler(controller.updateTemplate));
router.delete('/:id', asyncHandler(controller.deleteTemplate));

module.exports = router;
