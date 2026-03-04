'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const { requirePermission } = require('../../middleware/requirePermission');
const controller        = require('./students.controller');

router.use(verifyToken);

router.post(  '/',   requirePermission('students:create'), asyncHandler(controller.createStudent));
router.get(   '/',   requirePermission('students:read'),   asyncHandler(controller.getStudents));
router.get(   '/:id', requirePermission('students:read'),   asyncHandler(controller.getStudentById));
router.put(   '/:id', requirePermission('students:update'), asyncHandler(controller.updateStudent));
router.delete('/:id', requirePermission('students:delete'), asyncHandler(controller.deleteStudent));

module.exports = router;
