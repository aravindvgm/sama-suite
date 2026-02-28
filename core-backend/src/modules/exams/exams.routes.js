'use strict';

const express           = require('express');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./exams.controller');

router.use(verifyToken);

router.post('/',                         requirePermission('exams:create'), asyncHandler(controller.createExam));
router.post('/marks',                    requirePermission('exams:create'), asyncHandler(controller.addStudentMarks));
router.get( '/marks/student/:studentId', requirePermission('exams:read'),   asyncHandler(controller.getStudentReport));
router.put( '/marks/:id',                requirePermission('exams:update'), asyncHandler(controller.updateMarks));
router.delete('/marks/:id',              requirePermission('exams:delete'), asyncHandler(controller.deleteMarks));

module.exports = router;
