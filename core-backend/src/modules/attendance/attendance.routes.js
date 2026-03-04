'use strict';

/**
 * attendance.routes.js
 *
 * Mounted at: /api/:organizationId/attendance
 *
 * All routes run AFTER tenantStack:
 *   verifyToken → tenantLimiter → requireTenant → rateLimitMiddleware → requireActiveSubscription
 *
 * DO NOT add verifyToken here — already applied by tenantStack.
 *
 * Endpoints:
 *   GET  /section/:sectionId        — teacher load screen (roster + today's status)
 *   POST /bulk                      — teacher bulk mark (idempotent UPSERT)
 *   GET  /student/:studentId        — parent/teacher: last 7 days for one student
 *   GET  /dashboard                 — principal: stats + repeat absentees
 *   GET  /                          — raw attendance records by date (legacy)
 *   POST /                          — mark single attendance record (legacy)
 *   PUT  /:id                       — update single record
 *   DELETE /:id                     — soft delete
 */

const express           = require('express');
const router            = express.Router({ mergeParams: true });
const asyncHandler      = require('../../utils/asyncHandler');
const { requirePermission } = require('../../middleware/requirePermission');
const controller        = require('./attendance.controller');

// ── Teacher: section roster ────────────────────────────────────────────────────
// GET /api/:organizationId/attendance/section/:sectionId?date=YYYY-MM-DD
// Returns enrolled students + current attendance status for that date.
router.get(
  '/section/:sectionId',
  requirePermission('attendance:read'),
  asyncHandler(controller.getSectionRoster)
);

// ── Teacher: bulk mark ─────────────────────────────────────────────────────────
// POST /api/:organizationId/attendance/bulk
// Body: { sectionId, date, records: [{ studentId, enrollmentId, status }] }
// Idempotent — safe to retry on weak network.
router.post(
  '/bulk',
  requirePermission('attendance:create'),
  asyncHandler(controller.bulkMarkAttendance)
);

// ── Parent / teacher: single student history ───────────────────────────────────
// GET /api/:organizationId/attendance/student/:studentId
// Returns last 7 days (today inclusive).
router.get(
  '/student/:studentId',
  requirePermission('attendance:read'),
  asyncHandler(controller.getStudentAttendance)
);

// ── Principal: dashboard ───────────────────────────────────────────────────────
// GET /api/:organizationId/attendance/dashboard?date=YYYY-MM-DD
// Single response: overall %, absentee count, repeat absentees list.
router.get(
  '/dashboard',
  requirePermission('attendance:read'),
  asyncHandler(controller.getDashboard)
);

// ── Legacy single-record endpoints ────────────────────────────────────────────
router.get(   '/',    requirePermission('attendance:read'),   asyncHandler(controller.getAttendanceByDate));
router.post(  '/',    requirePermission('attendance:create'), asyncHandler(controller.markAttendance));
router.put(   '/:id', requirePermission('attendance:update'), asyncHandler(controller.updateAttendance));
router.delete('/:id', requirePermission('attendance:delete'), asyncHandler(controller.deleteAttendance));

module.exports = router;
