'use strict';

const cron = require('node-cron');
const pool = require('../config/db');

const { getStudentActions }      = require('../modules/ai/studentActionEngine.service');
const { sendWhatsAppMessage }    = require('../utils/whatsapp.service');
const { createNotificationLog,
        logSuccess,
        logFailure }             = require('./notificationLogs.service');

// ============================================================
// CONSTANTS
// ============================================================

const REMINDER_TYPE_ATTENDANCE = 'ATTENDANCE_REMINDER';
const REMINDER_TYPE_FEE        = 'FEE_REMINDER';
const REMINDER_TYPE_OUTREACH   = 'MANUAL_OUTREACH';

const THROTTLE_MS    = 300;                                // ms between sends
const CRON_SCHEDULE  = '0 8 * * *';                       // daily 08:00
const CRON_TIMEZONE  = process.env.CRON_TIMEZONE || 'Asia/Kolkata';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// FETCH ACTIVE ORGANISATIONS
// ============================================================

async function fetchActiveOrganizations() {
  const { rows } = await pool.query(
    `SELECT id, name
     FROM   organizations
     WHERE  deleted_at IS NULL
     ORDER  BY id`
  );
  return rows;
}

// ============================================================
// BATCH CONTACT FETCH
//
// Single query for all student IDs in this org run.
// Returns a Map<studentId, { father_mobile, mother_mobile, primary_contact }>
// so every subsequent lookup is O(1) — no per-student queries.
// ============================================================

async function fetchContactMap(studentIds, organizationId) {
  if (studentIds.length === 0) return new Map();

  const { rows } = await pool.query(
    `SELECT id, father_mobile, mother_mobile, primary_contact
     FROM   students
     WHERE  id              = ANY($1::uuid[])
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentIds, organizationId]
  );

  return new Map(rows.map((r) => [r.id, r]));
}

// ============================================================
// BATCH IDEMPOTENCY CHECK
//
// Returns a Set of "studentId:reminderType" keys for all
// notifications already dispatched today for this org.
// One query covers all three action types.
// ============================================================

async function fetchActedTodaySet(organizationId) {
  const { rows } = await pool.query(
    `SELECT student_id, reminder_type
     FROM   notification_logs
     WHERE  organization_id = $1
       AND  reminder_type   = ANY($2::text[])
       AND  DATE(created_at) = CURRENT_DATE`,
    [organizationId, [REMINDER_TYPE_ATTENDANCE, REMINDER_TYPE_FEE, REMINDER_TYPE_OUTREACH]]
  );

  return new Set(rows.map((r) => `${r.student_id}:${r.reminder_type}`));
}

function hasActedToday(actedToday, studentId, reminderType) {
  return actedToday.has(`${studentId}:${reminderType}`);
}

// ============================================================
// CONTACT RESOLUTION
//
// Respects primary_contact preference; falls back to whichever
// mobile is available.
// ============================================================

function resolveContact(contactRow) {
  if (!contactRow) return null;
  const { father_mobile, mother_mobile, primary_contact } = contactRow;
  if (primary_contact === 'MOTHER' && mother_mobile) return mother_mobile;
  if (primary_contact === 'FATHER' && father_mobile) return father_mobile;
  return father_mobile || mother_mobile || null;
}

// ============================================================
// MESSAGE BUILDERS
// ============================================================

function buildAttendanceMessage(studentName, attendancePct, orgName) {
  return (
    `Dear Parent, ${studentName}'s attendance is ${attendancePct}% ` +
    `which is below the required 75%. Please ensure regular school ` +
    `attendance. — ${orgName}`
  );
}

function buildFeeMessage(studentName, totalOverdueBalance, orgName) {
  const formatted = Number(totalOverdueBalance).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    `Dear Parent, ${studentName} has overdue fees of ₹${formatted} ` +
    `pending for more than 30 days. Please clear the dues at the ` +
    `earliest. — ${orgName}`
  );
}

function buildOutreachNote(studentName, failedCount) {
  return (
    `Manual outreach required for ${studentName}. ` +
    `${failedCount} delivery failure(s) in the last 7 days. ` +
    `Please verify contact details and attempt direct outreach.`
  );
}

// ============================================================
// EXECUTE — ATTENDANCE ACTIONS
//
// Triggered for CRITICAL and HIGH priority only.
// Sends a WhatsApp reminder to the student's primary contact.
// ============================================================

async function executeAttendanceActions({
  actions, contactMap, actedToday, organizationId, orgName, stats,
}) {
  const eligible = actions.filter((a) => a.priority === 'CRITICAL' || a.priority === 'HIGH');

  for (const action of eligible) {
    const { studentId, firstName, lastName, attendancePercentage } = action;

    if (hasActedToday(actedToday, studentId, REMINDER_TYPE_ATTENDANCE)) {
      console.log(`[AutoAction] ATTENDANCE skip (already acted today) → student=${studentId}`);
      stats.attendanceSkipped++;
      continue;
    }

    const contactRow = contactMap.get(studentId);
    const contact    = resolveContact(contactRow);

    if (!contact) {
      console.warn(`[AutoAction] ATTENDANCE skip (no contact) → student=${studentId}`);
      stats.attendanceSkipped++;
      continue;
    }

    const studentName = `${firstName} ${lastName}`.trim();
    const message     = buildAttendanceMessage(studentName, attendancePercentage, orgName);

    try {
      const result = await sendWhatsAppMessage(contact, message);
      await logSuccess({
        organizationId,
        studentId,
        feeId:        null,
        contactNumber: contact,
        channel:      'WHATSAPP',
        message,
        reminderType:  REMINDER_TYPE_ATTENDANCE,
        messageId:     result.messageId,
        attempts:      1,
      });
      stats.attendanceSent++;
      console.log(`[AutoAction] ATTENDANCE ✓ sent → student=${studentId} msgId=${result.messageId}`);
    } catch (err) {
      await logFailure({
        organizationId,
        studentId,
        feeId:         null,
        contactNumber: contact,
        channel:       'WHATSAPP',
        message,
        reminderType:  REMINDER_TYPE_ATTENDANCE,
        attempts:      1,
        errorMessage:  err.message,
      });
      stats.attendanceFailed++;
      console.error(`[AutoAction] ATTENDANCE ✗ failed → student=${studentId}: ${err.message}`);
    }

    await sleep(THROTTLE_MS);
  }
}

// ============================================================
// EXECUTE — FEE ACTIONS
//
// Triggered for HIGH priority only (overdueFeeCount >= 3).
// Sends a WhatsApp payment reminder to the primary contact.
// ============================================================

async function executeFeeActions({
  actions, contactMap, actedToday, organizationId, orgName, stats,
}) {
  const eligible = actions.filter((a) => a.priority === 'HIGH');

  for (const action of eligible) {
    const { studentId, firstName, lastName, totalOverdueBalance } = action;

    if (hasActedToday(actedToday, studentId, REMINDER_TYPE_FEE)) {
      console.log(`[AutoAction] FEE skip (already acted today) → student=${studentId}`);
      stats.feeSkipped++;
      continue;
    }

    const contactRow = contactMap.get(studentId);
    const contact    = resolveContact(contactRow);

    if (!contact) {
      console.warn(`[AutoAction] FEE skip (no contact) → student=${studentId}`);
      stats.feeSkipped++;
      continue;
    }

    const studentName = `${firstName} ${lastName}`.trim();
    const message     = buildFeeMessage(studentName, totalOverdueBalance, orgName);

    try {
      const result = await sendWhatsAppMessage(contact, message);
      await logSuccess({
        organizationId,
        studentId,
        feeId:         null,
        contactNumber: contact,
        channel:       'WHATSAPP',
        message,
        reminderType:  REMINDER_TYPE_FEE,
        messageId:     result.messageId,
        attempts:      1,
      });
      stats.feeSent++;
      console.log(`[AutoAction] FEE ✓ sent → student=${studentId} msgId=${result.messageId}`);
    } catch (err) {
      await logFailure({
        organizationId,
        studentId,
        feeId:         null,
        contactNumber: contact,
        channel:       'WHATSAPP',
        message,
        reminderType:  REMINDER_TYPE_FEE,
        attempts:      1,
        errorMessage:  err.message,
      });
      stats.feeFailed++;
      console.error(`[AutoAction] FEE ✗ failed → student=${studentId}: ${err.message}`);
    }

    await sleep(THROTTLE_MS);
  }
}

// ============================================================
// EXECUTE — COMMUNICATION RECOVERY ACTIONS
//
// Triggered for HIGH priority only (>= 5 failed notifications).
// Creates a MANUAL_OUTREACH task record in notification_logs
// with status PENDING — no WhatsApp is sent; the record surfaces
// in the staff task queue for human follow-up.
// ============================================================

async function executeManualOutreachTasks({
  actions, contactMap, actedToday, organizationId, stats,
}) {
  const eligible = actions.filter((a) => a.priority === 'HIGH');

  for (const action of eligible) {
    const { studentId, firstName, lastName, failedNotificationCount } = action;

    if (hasActedToday(actedToday, studentId, REMINDER_TYPE_OUTREACH)) {
      console.log(`[AutoAction] OUTREACH skip (task already created today) → student=${studentId}`);
      stats.outreachSkipped++;
      continue;
    }

    const contactRow  = contactMap.get(studentId);
    const contact     = resolveContact(contactRow);
    const studentName = `${firstName} ${lastName}`.trim();
    const note        = buildOutreachNote(studentName, failedNotificationCount);

    // Insert a PENDING task record — never throws (createNotificationLog has its own guard)
    await createNotificationLog({
      organizationId,
      studentId,
      feeId:         null,
      contactNumber: contact || null,
      channel:       'WHATSAPP',
      message:       note,
      reminderType:  REMINDER_TYPE_OUTREACH,
      status:        'PENDING',
      attempts:      0,
    });

    stats.outreachTasksCreated++;
    console.log(`[AutoAction] OUTREACH task created → student=${studentId}`);

    await sleep(THROTTLE_MS);
  }
}

// ============================================================
// PROCESS ONE ORGANISATION
//
// Execution order per org:
//   1. getStudentActions  — 3 concurrent DB queries (via action engine)
//   2. Collect all unique student IDs from all action lists
//   3. Promise.all: batch contact fetch + batch idempotency check
//   4. Execute the three action categories sequentially
// ============================================================

async function processOrg(org, stats) {
  const label = `[AutoAction][org=${org.id}]`;
  console.log(`${label} Starting...`);

  let actionData;
  try {
    actionData = await getStudentActions({ organizationId: org.id });
  } catch (err) {
    console.error(`${label} getStudentActions failed: ${err.message}`);
    return; // skip this org; do not crash other orgs
  }

  const { lowAttendanceActions, overdueFeeActions, communicationRecoveryActions } = actionData;

  // Collect every student ID that will need a contact or idempotency check
  const allStudentIds = [
    ...new Set([
      ...lowAttendanceActions.map((s) => s.studentId),
      ...overdueFeeActions.map((s) => s.studentId),
      ...communicationRecoveryActions.map((s) => s.studentId),
    ]),
  ];

  if (allStudentIds.length === 0) {
    console.log(`${label} No at-risk students — nothing to action.`);
    stats.orgsProcessed++;
    return;
  }

  // Fetch contacts + idempotency set in parallel — one round-trip each
  const [contactMap, actedToday] = await Promise.all([
    fetchContactMap(allStudentIds, org.id),
    fetchActedTodaySet(org.id),
  ]);

  // Execute each action category
  await executeAttendanceActions({
    actions: lowAttendanceActions,
    contactMap, actedToday,
    organizationId: org.id,
    orgName: org.name,
    stats,
  });

  await executeFeeActions({
    actions: overdueFeeActions,
    contactMap, actedToday,
    organizationId: org.id,
    orgName: org.name,
    stats,
  });

  await executeManualOutreachTasks({
    actions: communicationRecoveryActions,
    contactMap, actedToday,
    organizationId: org.id,
    stats,
  });

  stats.orgsProcessed++;
  console.log(`${label} Done.`);
}

// ============================================================
// MAIN ENTRY POINT
//
// Fetches all active organisations, then processes them
// sequentially to avoid overwhelming the WhatsApp gateway.
// Each org is fully isolated — one org failure does not
// prevent subsequent orgs from being processed.
// ============================================================

async function runStudentAutoActions() {
  console.log('[AutoAction] Worker started.');

  const stats = {
    orgsProcessed:       0,
    attendanceSent:      0,
    attendanceFailed:    0,
    attendanceSkipped:   0,
    feeSent:             0,
    feeFailed:           0,
    feeSkipped:          0,
    outreachTasksCreated: 0,
    outreachSkipped:     0,
  };

  let orgs;
  try {
    orgs = await fetchActiveOrganizations();
  } catch (err) {
    console.error('[AutoAction] Failed to fetch organizations:', err.message);
    return stats;
  }

  console.log(`[AutoAction] Processing ${orgs.length} organisation(s).`);

  for (const org of orgs) {
    try {
      await processOrg(org, stats);
    } catch (err) {
      // Isolate per-org failures — other orgs must still run
      console.error(`[AutoAction][org=${org.id}] Unhandled error: ${err.message}`);
    }
  }

  console.log('[AutoAction] Run complete.', stats);
  return stats;
}

// ============================================================
// CRON SCHEDULE  —  daily 08:00
// ============================================================

if (require.main === module) {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await runStudentAutoActions();
    } catch (err) {
      console.error('[AutoAction] Cron job failed:', err.message);
    }
  }, { timezone: CRON_TIMEZONE });

  console.log(`[AutoAction] Worker scheduled at "${CRON_SCHEDULE}" (${CRON_TIMEZONE})`);

  process.on('uncaughtException',  (err) => console.error('[AutoAction] uncaughtException:', err));
  process.on('unhandledRejection', (err) => console.error('[AutoAction] unhandledRejection:', err));
}

module.exports = { runStudentAutoActions };
