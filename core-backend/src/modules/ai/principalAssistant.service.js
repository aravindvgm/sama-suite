'use strict';

const pool = require('../../config/db');

// Existing services — zero new SQL written in this module
const {
  getStudentEarlyWarning,
  fetchLowAttendanceStudents,
  fetchOverdueFeeStudents,
  fetchFailedNotificationStudents,
} = require('../students/studentEarlyWarning.service');

const { getAdminOverview }    = require('../admin/adminOverviewDashboard.service');
const { getStudentOverview }  = require('../students/studentOverview.service');
const { getSession, upsertSession } = require('./assistantSession.service');

// ============================================================
// INTENT CATALOGUE
// ============================================================

const INTENT = {
  OVERDUE_FEES:         'OVERDUE_FEES',
  LOW_ATTENDANCE:       'LOW_ATTENDANCE',
  COMMUNICATION_ISSUES: 'COMMUNICATION_ISSUES',
  EARLY_WARNING:        'EARLY_WARNING',
  DASHBOARD_OVERVIEW:   'DASHBOARD_OVERVIEW',
  BIRTHDAY_TODAY:       'BIRTHDAY_TODAY',
  TODAY_COLLECTION:     'TODAY_COLLECTION',
  STUDENT_PROFILE:      'STUDENT_PROFILE',
  UNKNOWN:              'UNKNOWN',
};

// Rules evaluated in order — first match wins.
// Ordered from most-specific to least-specific to avoid false matches.
const INTENT_RULES = [
  {
    intent:  INTENT.BIRTHDAY_TODAY,
    pattern: /birthday/i,
  },
  {
    intent:  INTENT.OVERDUE_FEES,
    pattern: /overdue|outstanding.*fee|fee.*due|unpaid.*fee|due.*fee|fee.*outstanding|dues/i,
  },
  {
    intent:  INTENT.LOW_ATTENDANCE,
    pattern: /low.*attend|attend.*(low|below|poor|bad)|absent.*student|truant|attendance.*percent/i,
  },
  {
    intent:  INTENT.COMMUNICATION_ISSUES,
    pattern: /notif.*fail|fail.*notif|unreachable|contact.*fail|communic.*fail|message.*fail/i,
  },
  {
    intent:  INTENT.EARLY_WARNING,
    pattern: /at.?risk|early.?warning|struggling|warning|red.?flag|needs.*attention|problem.*student/i,
  },
  {
    intent:  INTENT.TODAY_COLLECTION,
    pattern: /today.*collect|collect.*today|revenue|how much.*collect|fee.*collect|money.*collect/i,
  },
  {
    intent:  INTENT.STUDENT_PROFILE,
    pattern: /profile|student.*detail|detail.*student|student.*overview|overview.*student|tell me about/i,
  },
  {
    intent:  INTENT.DASHBOARD_OVERVIEW,
    pattern: /overview|dashboard|summary|statistic|how many student|total student|quick report/i,
  },
];

// ============================================================
// INTENT DETECTOR
// ============================================================

function detectIntent(question) {
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(question)) {
      return rule.intent;
    }
  }
  return INTENT.UNKNOWN;
}

// ============================================================
// HELPERS
// ============================================================

function fmt(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Extract an admission number token from a question string.
// Matches patterns like ADM001, STU-2024-01, 20240001.
function extractAdmissionNo(question) {
  const match = question.match(/\b([A-Za-z]{0,5}[-]?\d{3,})\b/);
  return match ? match[1].toUpperCase() : null;
}

// Resolve a studentId from an admission number — the only new
// query in this module (no existing service covers this lookup).
async function resolveStudentId(admissionNo, organizationId) {
  const { rows } = await pool.query(
    `SELECT id FROM students
     WHERE  admission_number = $1
       AND  organization_id  = $2
       AND  deleted_at IS NULL
     LIMIT  1`,
    [admissionNo, organizationId]
  );
  return rows[0] ? rows[0].id : null;
}

// ============================================================
// FOLLOW-UP DETECTION
//
// Matches vague referential questions like "send reminders to them",
// "notify those students", "remind them".  When detected, we try
// to resolve "them" from the user's active session context before
// falling through to normal intent detection.
// ============================================================

const FOLLOW_UP_PATTERN  = /\b(them|those students?|those|these students?|these)\b/i;
const WANTS_CAMPAIGN_RE  = /send|remind|notify|contact|message|campaign|reach/i;

// Maps intents that have a clear single "them" group → campaign type.
// EARLY_WARNING is excluded (ambiguous: which group?).
const CAMPAIGN_FOR_INTENT = {
  [INTENT.OVERDUE_FEES]:         'OVERDUE_FEES',
  [INTENT.LOW_ATTENDANCE]:       'LOW_ATTENDANCE',
  [INTENT.COMMUNICATION_ISSUES]: null, // manual outreach, not a campaign
};

// ============================================================
// ACTION SUGGESTIONS CATALOGUE
// Keyed by intent. Returned alongside every answer so the
// frontend can render one-click action buttons.
// ============================================================

const ACTION_SUGGESTIONS = {
  [INTENT.OVERDUE_FEES]: [
    { type: 'LAUNCH_CAMPAIGN', campaignType: 'OVERDUE_FEES' },
  ],
  [INTENT.LOW_ATTENDANCE]: [
    { type: 'LAUNCH_CAMPAIGN', campaignType: 'LOW_ATTENDANCE' },
  ],
  [INTENT.COMMUNICATION_ISSUES]: [
    { type: 'TRIGGER_MANUAL_OUTREACH' },
  ],
  [INTENT.EARLY_WARNING]: [
    { type: 'LAUNCH_CAMPAIGN', campaignType: 'LOW_ATTENDANCE' },
    { type: 'LAUNCH_CAMPAIGN', campaignType: 'OVERDUE_FEES' },
    { type: 'VIEW_REPORT',     reportType:   'EARLY_WARNING' },
  ],
  [INTENT.DASHBOARD_OVERVIEW]: [
    { type: 'VIEW_REPORT', reportType: 'DASHBOARD' },
  ],
  [INTENT.BIRTHDAY_TODAY]: [
    { type: 'LAUNCH_CAMPAIGN', campaignType: 'FESTIVAL_GREETING' },
  ],
  [INTENT.TODAY_COLLECTION]: [
    { type: 'VIEW_REPORT', reportType: 'PAYMENTS' },
  ],
  [INTENT.STUDENT_PROFILE]: [],
  [INTENT.UNKNOWN]:         [],
};

// ============================================================
// FOLLOW-UP QUESTIONS CATALOGUE
// Keyed by intent. Surfaced after every answer so the user can
// drill deeper with a single tap.
// ============================================================

const FOLLOW_UP_QUESTIONS = {
  [INTENT.OVERDUE_FEES]: [
    'Show top overdue students',
    'Send reminder campaign',
    'Show fee collection today',
  ],
  [INTENT.LOW_ATTENDANCE]: [
    'Which students have below 50% attendance?',
    'Send attendance reminder campaign',
    'Show early warning report',
  ],
  [INTENT.COMMUNICATION_ISSUES]: [
    'Show students with failed notifications',
    'Show early warning report',
    'Give me a dashboard overview',
  ],
  [INTENT.EARLY_WARNING]: [
    'Which students have overdue fees?',
    'Show me students with low attendance',
    'Send attendance reminder campaign',
    'Send overdue fee reminder campaign',
  ],
  [INTENT.DASHBOARD_OVERVIEW]: [
    'Which students have overdue fees?',
    'Show me students with low attendance',
    'What is today\'s fee collection?',
    'Show early warning report',
  ],
  [INTENT.BIRTHDAY_TODAY]: [
    'Send birthday greetings to all students',
    'Give me a dashboard overview',
    'What is today\'s fee collection?',
  ],
  [INTENT.TODAY_COLLECTION]: [
    'Show top overdue students',
    'Send overdue fee reminder campaign',
    'Give me a dashboard overview',
  ],
  [INTENT.STUDENT_PROFILE]: [
    'Which students have overdue fees?',
    'Show me students with low attendance',
    'Show early warning report',
  ],
  [INTENT.UNKNOWN]: [
    'Which students have overdue fees?',
    'Show me students with low attendance',
    'What is today\'s fee collection?',
    'Give me a dashboard overview',
  ],
};

// ============================================================
// INTENT HANDLERS
// Each handler returns { answer, data, confidence, actionSuggestions, followUpQuestions }.
// ============================================================

async function handleOverdueFees(organizationId) {
  const students = await fetchOverdueFeeStudents({ organizationId });
  const count    = students.length;

  let answer;
  if (count === 0) {
    answer = 'No students currently have overdue fees.';
  } else {
    const top  = students[0];
    const name = `${top.firstName} ${top.lastName}`.trim();
    answer =
      `${count} student${count !== 1 ? 's have' : ' has'} overdue fees. ` +
      `Highest outstanding balance is ${fmt(top.totalOverdueBalance)} (${name}).`;
  }

  return {
    answer,
    data:              { count, students },
    confidence:        'HIGH',
    actionSuggestions: count > 0 ? ACTION_SUGGESTIONS[INTENT.OVERDUE_FEES] : [],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.OVERDUE_FEES],
  };
}

async function handleLowAttendance(organizationId) {
  const students = await fetchLowAttendanceStudents({ organizationId });
  const count    = students.length;

  let answer;
  if (count === 0) {
    answer = 'All students currently meet the 75% attendance threshold.';
  } else {
    const worst  = students[0];
    const name   = `${worst.firstName} ${worst.lastName}`.trim();
    answer =
      `${count} student${count !== 1 ? 's have' : ' has'} attendance below 75%. ` +
      `Lowest is ${worst.attendancePercentage}% (${name}).`;
  }

  return {
    answer,
    data:              { count, students },
    confidence:        'HIGH',
    actionSuggestions: count > 0 ? ACTION_SUGGESTIONS[INTENT.LOW_ATTENDANCE] : [],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.LOW_ATTENDANCE],
  };
}

async function handleCommunicationIssues(organizationId) {
  const students = await fetchFailedNotificationStudents({ organizationId });
  const count    = students.length;

  let answer;
  if (count === 0) {
    answer = 'No communication issues detected in the last 7 days.';
  } else {
    answer =
      `${count} student${count !== 1 ? 's have' : ' has'} 3 or more failed ` +
      `notification attempts in the last 7 days. Manual outreach is recommended.`;
  }

  return {
    answer,
    data:              { count, students },
    confidence:        'HIGH',
    actionSuggestions: count > 0 ? ACTION_SUGGESTIONS[INTENT.COMMUNICATION_ISSUES] : [],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.COMMUNICATION_ISSUES],
  };
}

async function handleEarlyWarning(organizationId) {
  const {
    lowAttendanceStudents,
    overdueFeeStudents,
    failedNotificationStudents,
  } = await getStudentEarlyWarning({ organizationId });

  const total =
    lowAttendanceStudents.length +
    overdueFeeStudents.length +
    failedNotificationStudents.length;

  let answer;
  if (total === 0) {
    answer = 'No students are currently flagged for early warning.';
  } else {
    const parts = [];
    if (lowAttendanceStudents.length)
      parts.push(`${lowAttendanceStudents.length} with low attendance`);
    if (overdueFeeStudents.length)
      parts.push(`${overdueFeeStudents.length} with overdue fees`);
    if (failedNotificationStudents.length)
      parts.push(`${failedNotificationStudents.length} with communication issues`);
    answer = `${total} student${total !== 1 ? 's need' : ' needs'} attention: ${parts.join(', ')}.`;
  }

  // Only surface campaign actions for signals that actually have students
  const actionSuggestions = [];
  if (lowAttendanceStudents.length)
    actionSuggestions.push({ type: 'LAUNCH_CAMPAIGN', campaignType: 'LOW_ATTENDANCE' });
  if (overdueFeeStudents.length)
    actionSuggestions.push({ type: 'LAUNCH_CAMPAIGN', campaignType: 'OVERDUE_FEES' });
  if (total > 0)
    actionSuggestions.push({ type: 'VIEW_REPORT', reportType: 'EARLY_WARNING' });

  return {
    answer,
    data: {
      lowAttendanceStudents,
      overdueFeeStudents,
      failedNotificationStudents,
    },
    confidence:        'HIGH',
    actionSuggestions,
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.EARLY_WARNING],
  };
}

async function handleDashboardOverview(organizationId) {
  const overview = await getAdminOverview({ organizationId });

  const attendanceLine = overview.todayAttendancePercentage !== null
    ? `${overview.todayAttendancePercentage}% attendance today`
    : 'no attendance data yet today';

  const answer =
    `Dashboard snapshot: ${attendanceLine}, ` +
    `${fmt(overview.todayCollection)} collected today, ` +
    `${overview.pendingFeesCount} pending fee records, ` +
    `${overview.birthdayStudentsToday} birthday${overview.birthdayStudentsToday !== 1 ? 's' : ''} today, ` +
    `${overview.notificationsSentToday} notifications sent, ` +
    `${overview.failedNotificationsToday} failed, ` +
    `${overview.pendingReconcilePayments} payment${overview.pendingReconcilePayments !== 1 ? 's' : ''} pending reconciliation.`;

  return {
    answer,
    data:              overview,
    confidence:        'HIGH',
    actionSuggestions: ACTION_SUGGESTIONS[INTENT.DASHBOARD_OVERVIEW],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.DASHBOARD_OVERVIEW],
  };
}

async function handleBirthdayToday(organizationId) {
  const { birthdayStudentsToday } = await getAdminOverview({ organizationId });
  const n = birthdayStudentsToday;

  const answer = n === 0
    ? 'No students have birthdays today.'
    : `${n} student${n !== 1 ? 's have' : ' has'} a birthday today.`;

  return {
    answer,
    data:              { birthdayStudentsToday: n },
    confidence:        'HIGH',
    actionSuggestions: n > 0 ? ACTION_SUGGESTIONS[INTENT.BIRTHDAY_TODAY] : [],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.BIRTHDAY_TODAY],
  };
}

async function handleTodayCollection(organizationId) {
  const { todayCollection, pendingReconcilePayments } = await getAdminOverview({ organizationId });

  const answer =
    `Today's fee collection is ${fmt(todayCollection)}. ` +
    `${pendingReconcilePayments} payment${pendingReconcilePayments !== 1 ? 's are' : ' is'} pending reconciliation.`;

  return {
    answer,
    data:              { todayCollection, pendingReconcilePayments },
    confidence:        'HIGH',
    actionSuggestions: ACTION_SUGGESTIONS[INTENT.TODAY_COLLECTION],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.TODAY_COLLECTION],
  };
}

async function handleStudentProfile(question, organizationId) {
  const admissionNo = extractAdmissionNo(question);

  if (!admissionNo) {
    return {
      answer:            'Please include the student\'s admission number in your question to retrieve their profile.',
      data:              null,
      confidence:        'LOW',
      actionSuggestions: [],
      followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.STUDENT_PROFILE],
    };
  }

  const studentId = await resolveStudentId(admissionNo, organizationId);
  if (!studentId) {
    return {
      answer:            `No student found with admission number "${admissionNo}".`,
      data:              null,
      confidence:        'HIGH',
      actionSuggestions: [],
      followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.STUDENT_PROFILE],
    };
  }

  const profile = await getStudentOverview({ organizationId, studentId });
  const name    = `${profile.studentProfile.first_name} ${profile.studentProfile.last_name}`.trim();

  const answer =
    `Profile for ${name} (${admissionNo}): ` +
    `attendance ${profile.attendanceSummary.attendancePercentage}%, ` +
    `pending balance ${fmt(profile.feeSummary.pendingBalance)}.`;

  return {
    answer,
    data:              profile,
    confidence:        'HIGH',
    actionSuggestions: [{ type: 'VIEW_STUDENT_PROFILE', studentId }],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.STUDENT_PROFILE],
  };
}

function handleUnknown() {
  const suggestions = [
    '"Which students have overdue fees?"',
    '"Show me students with low attendance"',
    '"What is today\'s fee collection?"',
    '"How many students have birthdays today?"',
    '"Show early warning report"',
    '"Give me a dashboard overview"',
    '"Show me student profile for ADM001"',
  ];

  return {
    answer:
      'I could not understand your question. Try asking:\n' +
      suggestions.map((s) => `  • ${s}`).join('\n'),
    data:              null,
    confidence:        'LOW',
    actionSuggestions: [],
    followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.UNKNOWN],
  };
}

// ============================================================
// SESSION CONTEXT HELPERS
// ============================================================

// Distil the minimum data needed for follow-up resolution from
// a handler result.  Avoids storing large student arrays in JSONB.
function buildContextJson(intent, result) {
  const { data } = result;
  if (!data) return { intent };

  switch (intent) {
    case INTENT.OVERDUE_FEES:
    case INTENT.LOW_ATTENDANCE:
    case INTENT.COMMUNICATION_ISSUES:
      return {
        intent,
        count:      data.count,
        topStudent: data.students && data.students[0]
          ? { firstName: data.students[0].firstName, lastName: data.students[0].lastName }
          : null,
      };

    case INTENT.EARLY_WARNING:
      return {
        intent,
        lowAttendanceCount:      data.lowAttendanceStudents.length,
        overdueFeeCount:         data.overdueFeeStudents.length,
        failedNotificationCount: data.failedNotificationStudents.length,
      };

    case INTENT.TODAY_COLLECTION:
      return {
        intent,
        todayCollection:          data.todayCollection,
        pendingReconcilePayments: data.pendingReconcilePayments,
      };

    case INTENT.BIRTHDAY_TODAY:
      return { intent, birthdayStudentsToday: data.birthdayStudentsToday };

    case INTENT.DASHBOARD_OVERVIEW:
      return {
        intent,
        todayAttendancePercentage: data.todayAttendancePercentage,
        pendingFeesCount:          data.pendingFeesCount,
        todayCollection:           data.todayCollection,
      };

    default:
      return { intent };
  }
}

// Attempt to resolve a follow-up question ("send reminders to them")
// using the stored session context.
// Returns a handler-style result object, or null to fall through to
// normal intent detection.
function resolveFollowUp({ question, session }) {
  const { last_intent: intent, context_json: ctx = {} } = session;

  const campaignType = CAMPAIGN_FOR_INTENT[intent];

  if (WANTS_CAMPAIGN_RE.test(question)) {
    if (campaignType) {
      const label    = campaignType === 'OVERDUE_FEES' ? 'overdue fee' : 'low attendance';
      const countStr = ctx.count != null ? `${ctx.count} ` : '';

      return {
        answer:
          `Ready to send ${label} reminders to ${countStr}students from your previous query. ` +
          `Tap "Launch Campaign" below to proceed.`,
        data:              ctx,
        confidence:        'HIGH',
        actionSuggestions: [{ type: 'LAUNCH_CAMPAIGN', campaignType }],
        followUpQuestions: FOLLOW_UP_QUESTIONS[intent] || [],
        contextResolved:   true,
      };
    }

    // COMMUNICATION_ISSUES — campaign not available, surface manual outreach
    if (intent === INTENT.COMMUNICATION_ISSUES) {
      const countStr = ctx.count != null ? `${ctx.count} ` : '';
      return {
        answer:
          `Manual outreach is recommended for ${countStr}students with failed notifications. ` +
          `Use the action below to initiate.`,
        data:              ctx,
        confidence:        'HIGH',
        actionSuggestions: [{ type: 'TRIGGER_MANUAL_OUTREACH' }],
        followUpQuestions: FOLLOW_UP_QUESTIONS[INTENT.COMMUNICATION_ISSUES],
        contextResolved:   true,
      };
    }
  }

  // No specific resolution available — caller falls through to intent detection
  return null;
}

// ============================================================
// MAIN
// ============================================================

async function answerQuestion({ organizationId, userId, question }) {
  if (!question || !question.trim()) {
    const err = new Error('question is required and must not be empty');
    err.statusCode = 422;
    throw err;
  }

  const trimmed = question.trim();

  // ── Follow-up resolution ────────────────────────────────────
  // If the question contains a vague reference ("them", "those students"),
  // try to resolve it from the user's stored session context before
  // running the full intent + query pipeline.
  if (userId && FOLLOW_UP_PATTERN.test(trimmed)) {
    const session = await getSession({ organizationId, userId });

    if (session && session.last_intent) {
      const resolved = resolveFollowUp({ question: trimmed, session });

      if (resolved) {
        // Re-persist session with same context (keeps updated_at fresh)
        upsertSession({
          organizationId,
          userId,
          intent:      session.last_intent,
          contextJson: session.context_json || {},
        }).catch(() => {});

        return {
          question:          trimmed,
          intent:            session.last_intent,
          answer:            resolved.answer,
          confidence:        resolved.confidence,
          data:              resolved.data,
          actionSuggestions: resolved.actionSuggestions,
          followUpQuestions: resolved.followUpQuestions,
          contextResolved:   true,
        };
      }
    }
  }

  // ── Normal intent detection + handler dispatch ──────────────
  const intent = detectIntent(trimmed);

  let result;
  switch (intent) {
    case INTENT.OVERDUE_FEES:
      result = await handleOverdueFees(organizationId);
      break;
    case INTENT.LOW_ATTENDANCE:
      result = await handleLowAttendance(organizationId);
      break;
    case INTENT.COMMUNICATION_ISSUES:
      result = await handleCommunicationIssues(organizationId);
      break;
    case INTENT.EARLY_WARNING:
      result = await handleEarlyWarning(organizationId);
      break;
    case INTENT.DASHBOARD_OVERVIEW:
      result = await handleDashboardOverview(organizationId);
      break;
    case INTENT.BIRTHDAY_TODAY:
      result = await handleBirthdayToday(organizationId);
      break;
    case INTENT.TODAY_COLLECTION:
      result = await handleTodayCollection(organizationId);
      break;
    case INTENT.STUDENT_PROFILE:
      result = await handleStudentProfile(trimmed, organizationId);
      break;
    default:
      result = handleUnknown();
  }

  // ── Persist session context fire-and-forget ─────────────────
  upsertSession({
    organizationId,
    userId: userId || null,
    intent,
    contextJson: buildContextJson(intent, result),
  }).catch(() => {});

  return {
    question:          trimmed,
    intent,
    answer:            result.answer,
    confidence:        result.confidence,
    data:              result.data,
    actionSuggestions: result.actionSuggestions,
    followUpQuestions: result.followUpQuestions,
    contextResolved:   false,
  };
}

module.exports = { answerQuestion };
