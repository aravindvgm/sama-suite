'use strict';

const { getStudentEarlyWarning } = require('../students/studentEarlyWarning.service');

// ============================================================
// ACTION DEFINITIONS
//
// Typed constants keep action identifiers consistent across the
// system — API consumers can key on `type` for deep-link routing
// (e.g. open "Send Payment Link" modal) while `label` is the
// human-readable display string.
// ============================================================

const ATTENDANCE_ACTIONS = [
  { type: 'PARENT_MEETING',    label: 'Schedule parent meeting'           },
  { type: 'TEACHER_ALERT',     label: 'Notify class teacher'              },
  { type: 'WHATSAPP_REMINDER', label: 'Send WhatsApp attendance reminder' },
];

const FEE_ACTIONS = [
  { type: 'PAYMENT_LINK',     label: 'Send payment link to parent'    },
  { type: 'FINANCE_FOLLOWUP', label: 'Assign finance team follow-up'  },
];

const COMMUNICATION_ACTIONS = [
  { type: 'CONTACT_VERIFICATION', label: 'Verify alternate contact number' },
  { type: 'MANUAL_OUTREACH',      label: 'Initiate manual outreach'        },
];

// ============================================================
// PRIORITY HELPERS
//
// Priority is derived from signal severity so the dashboard
// can surface the most critical students at the top.
// ============================================================

function resolveAttendancePriority(pct) {
  if (pct < 50) return 'CRITICAL';
  if (pct < 65) return 'HIGH';
  return 'MEDIUM';                  // 65–74.9 still below threshold
}

function resolveFeePriority(overdueCount) {
  return overdueCount >= 3 ? 'HIGH' : 'MEDIUM';
}

function resolveCommunicationPriority(failedCount) {
  return failedCount >= 5 ? 'HIGH' : 'MEDIUM';
}

// ============================================================
// MAPPERS
//
// Each mapper converts the raw student rows returned by
// studentEarlyWarning into enriched action objects.
// A spread of the original row preserves all signal fields
// so callers never need to cross-reference two responses.
// ============================================================

function mapToAttendanceActions(students) {
  return students.map((s) => ({
    studentId:            s.studentId,
    admissionNo:          s.admissionNo,
    firstName:            s.firstName,
    lastName:             s.lastName,
    attendancePercentage: s.attendancePercentage,
    totalDays:            s.totalDays,
    effectiveDays:        s.effectiveDays,
    priority:             resolveAttendancePriority(s.attendancePercentage),
    recommendedActions:   ATTENDANCE_ACTIONS,
  }));
}

function mapToFeeActions(students) {
  return students.map((s) => ({
    studentId:          s.studentId,
    admissionNo:        s.admissionNo,
    firstName:          s.firstName,
    lastName:           s.lastName,
    overdueFeeCount:    s.overdueFeeCount,
    totalOverdueBalance: s.totalOverdueBalance,
    priority:           resolveFeePriority(s.overdueFeeCount),
    recommendedActions: FEE_ACTIONS,
  }));
}

function mapToCommunicationActions(students) {
  return students.map((s) => ({
    studentId:               s.studentId,
    admissionNo:             s.admissionNo,
    firstName:               s.firstName,
    lastName:                s.lastName,
    failedNotificationCount: s.failedNotificationCount,
    priority:                resolveCommunicationPriority(s.failedNotificationCount),
    recommendedActions:      COMMUNICATION_ACTIONS,
  }));
}

// ============================================================
// MAIN
//
// Delegates all DB work to getStudentEarlyWarning (which runs
// its three queries concurrently).  This layer is pure JS —
// no additional queries, no N+1.
//
// summary.totalAtRiskStudents uses a Set to deduplicate students
// who appear in more than one risk category.
// generatedAt allows API consumers to detect stale caches.
// ============================================================

async function getStudentActions({ organizationId }) {
  const {
    lowAttendanceStudents,
    overdueFeeStudents,
    failedNotificationStudents,
  } = await getStudentEarlyWarning({ organizationId });

  const lowAttendanceActions       = mapToAttendanceActions(lowAttendanceStudents);
  const overdueFeeActions          = mapToFeeActions(overdueFeeStudents);
  const communicationRecoveryActions = mapToCommunicationActions(failedNotificationStudents);

  // Deduplicated count — a student may appear in multiple categories
  const allStudentIds = new Set([
    ...lowAttendanceActions.map((s) => s.studentId),
    ...overdueFeeActions.map((s) => s.studentId),
    ...communicationRecoveryActions.map((s) => s.studentId),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalAtRiskStudents:      allStudentIds.size,
      lowAttendanceCount:       lowAttendanceActions.length,
      overdueFeeCount:          overdueFeeActions.length,
      communicationRecoveryCount: communicationRecoveryActions.length,
    },
    lowAttendanceActions,
    overdueFeeActions,
    communicationRecoveryActions,
  };
}

module.exports = { getStudentActions };
