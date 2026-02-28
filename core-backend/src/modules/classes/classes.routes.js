'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./classes.controller');

router.use(verifyToken);

// -------------------------------------------------------
// Classes
// -------------------------------------------------------
router.post(  '/',    requirePermission('classes:create'), asyncHandler(controller.createClass));
router.get(   '/',    requirePermission('classes:read'),   asyncHandler(controller.getClasses));
router.put(   '/:id', requirePermission('classes:update'), asyncHandler(controller.updateClass));
router.delete('/:id', requirePermission('classes:delete'), asyncHandler(controller.deleteClass));

// -------------------------------------------------------
// Sections  —  nested under /:classId/sections
// -------------------------------------------------------
router.post(  '/:classId/sections',    requirePermission('classes:create'), asyncHandler(controller.createSection));
router.get(   '/:classId/sections',    requirePermission('classes:read'),   asyncHandler(controller.getSectionsByClass));
router.put(   '/sections/:id',         requirePermission('classes:update'), asyncHandler(controller.updateSection));
router.delete('/sections/:id',         requirePermission('classes:delete'), asyncHandler(controller.deleteSection));

module.exports = router;
