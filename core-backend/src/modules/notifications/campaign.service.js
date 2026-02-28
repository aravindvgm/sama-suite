'use strict';

const pool   = require('../../config/db');
const logger = require('../../utils/logger');

const {
  fetchLowAttendanceStudents,
  fetchOverdueFeeStudents,
} = require('../students/studentEarlyWarning.service');

const { sendWhatsAppMessage } = require('../../utils/whatsapp.service');
const { logSuccess, logFailure } = require('../../workers/notificationLogs.service');
const {
  checkThresholds,
  createBatch,
  updateBatchStatus,
} = require('./messageBatch.service');

const CONFIRMATION_TOKEN = 'CONFIRM_SEND';

// ============================================================
// CAMPAIGN TYPES + REMINDER TYPE MAP
// ============================================================

const VALID_CAMPAIGN_TYPES = [
  'OVERDUE_FEES',
  'LOW_ATTENDANCE',
  'CLASS_BROADCAST',
  'FESTIVAL_GREETING',
];

const REMINDER_TYPE = {
  OVERDUE_FEES:      'OVERDUE_FEE_CAMPAIGN',
  LOW_ATTENDANCE:    'LOW_ATTENDANCE_CAMPAIGN',
  CLASS_BROADCAST:   'CLASS_BROADCAST',
  FESTIVAL_GREETING: 'FESTIVAL_GREETING',
};

const THROTTLE_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================
// BATCH CONTACT FETCH
//
// Used when recipient list comes from early warning queries
// which carry studentId/name but no contact numbers.
// Returns Map<studentId, { father_mobile, mother_mobile, primary_contact }>
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
// CONTACT RESOLUTION
//
// Respects primary_contact preference; falls back to whichever
// number is available.  Returns null when neither exists.
// ============================================================

function resolveContact({ father_mobile, mother_mobile, primary_contact }) {
  if (primary_contact === 'MOTHER' && mother_mobile) return mother_mobile;
  if (primary_contact === 'FATHER' && father_mobile) return father_mobile;
  return father_mobile || mother_mobile || null;
}

// ============================================================
// RECIPIENT FETCHERS
// ============================================================

// OVERDUE_FEES / LOW_ATTENDANCE
// Early-warning results carry no contacts — batch-fetch them.
async function buildRecipientsFromRiskList(riskStudents, organizationId) {
  if (riskStudents.length === 0) return [];

  const studentIds = riskStudents.map((s) => s.studentId);
  const contactMap = await fetchContactMap(studentIds, organizationId);

  return riskStudents.map((s) => {
    const c = contactMap.get(s.studentId) || {};
    return {
      student_id:      s.studentId,
      first_name:      s.firstName,
      last_name:       s.lastName,
      father_mobile:   c.father_mobile   || null,
      mother_mobile:   c.mother_mobile   || null,
      primary_contact: c.primary_contact || null,
    };
  });
}

// CLASS_BROADCAST — students enrolled in a specific class
async function fetchClassRecipients({ organizationId, classId }) {
  const { rows } = await pool.query(
    `SELECT
       s.id              AS student_id,
       s.first_name,
       s.last_name,
       s.father_mobile,
       s.mother_mobile,
       s.primary_contact
     FROM   students s
     JOIN   student_enrollments se
            ON  se.student_id      = s.id
            AND se.organization_id = $1
            AND se.class_id        = $2
            AND se.deleted_at IS NULL
     WHERE  s.organization_id = $1
       AND  s.deleted_at IS NULL
     ORDER  BY s.last_name, s.first_name`,
    [organizationId, classId]
  );
  return rows;
}

// FESTIVAL_GREETING — all active students in the organisation
async function fetchAllStudentRecipients({ organizationId }) {
  const { rows } = await pool.query(
    `SELECT
       id              AS student_id,
       first_name,
       last_name,
       father_mobile,
       mother_mobile,
       primary_contact
     FROM   students
     WHERE  organization_id = $1
       AND  deleted_at IS NULL
     ORDER  BY last_name, first_name`,
    [organizationId]
  );
  return rows;
}

// ============================================================
// CAMPAIGN RUNNER  (fire-and-forget)
//
// Iterates recipients, sends WhatsApp to one contact per student
// (primary preference), logs each outcome to notification_logs.
// Contact deduplication via Set prevents the same number from
// receiving duplicate messages within a single campaign run.
// 300ms throttle between sends respects gateway rate limits.
// ============================================================

async function runCampaign({ recipients, message, organizationId, reminderType, batchId }) {
  const stats    = { sent: 0, failed: 0, skipped: 0 };
  const sentNums = new Set();

  logger.info('Campaign: dispatch started', { organizationId, reminderType, batchId, total: recipients.length });

  for (const r of recipients) {
    const contact = resolveContact({
      father_mobile:   r.father_mobile,
      mother_mobile:   r.mother_mobile,
      primary_contact: r.primary_contact,
    });

    if (!contact) {
      logger.warn('Campaign: no contact for student — skipping', { organizationId, reminderType, studentId: r.student_id });
      stats.skipped++;
      continue;
    }

    if (sentNums.has(contact)) {
      // Same number linked to multiple students (siblings) — send once
      stats.skipped++;
      continue;
    }

    sentNums.add(contact);

    try {
      const result = await sendWhatsAppMessage(contact, message);
      await logSuccess({
        organizationId,
        studentId:     r.student_id,
        feeId:         null,
        contactNumber: contact,
        channel:       'WHATSAPP',
        message,
        reminderType,
        messageId:     result.messageId,
        attempts:      1,
      });
      stats.sent++;
    } catch (err) {
      await logFailure({
        organizationId,
        studentId:     r.student_id,
        feeId:         null,
        contactNumber: contact,
        channel:       'WHATSAPP',
        message,
        reminderType,
        attempts:      1,
        errorMessage:  err.message,
      });
      stats.failed++;
      logger.warn('Campaign: send failed for contact', { organizationId, reminderType, contactNumber: contact, error: err.message });
    }

    await sleep(THROTTLE_MS);
  }

  await updateBatchStatus(batchId, 'COMPLETED');
  logger.info('Campaign: dispatch complete', { organizationId, reminderType, batchId, ...stats });
}

// ============================================================
// MAIN
// ============================================================

async function launchCampaign({ organizationId, campaignType, message, classId, confirmationToken }) {
  // ── Validation ────────────────────────────────────────────
  if (!VALID_CAMPAIGN_TYPES.includes(campaignType)) {
    const err = new Error(
      `Invalid campaignType. Allowed: ${VALID_CAMPAIGN_TYPES.join(', ')}`
    );
    err.statusCode = 422;
    throw err;
  }

  if (!message || !message.trim()) {
    const err = new Error('message is required and must not be empty');
    err.statusCode = 422;
    throw err;
  }

  if (campaignType === 'CLASS_BROADCAST' && !classId) {
    const err = new Error('classId is required for CLASS_BROADCAST campaigns');
    err.statusCode = 422;
    throw err;
  }

  // ── Recipient resolution ──────────────────────────────────
  let recipients;

  if (campaignType === 'OVERDUE_FEES') {
    const riskStudents = await fetchOverdueFeeStudents({ organizationId });
    recipients = await buildRecipientsFromRiskList(riskStudents, organizationId);

  } else if (campaignType === 'LOW_ATTENDANCE') {
    const riskStudents = await fetchLowAttendanceStudents({ organizationId });
    recipients = await buildRecipientsFromRiskList(riskStudents, organizationId);

  } else if (campaignType === 'CLASS_BROADCAST') {
    recipients = await fetchClassRecipients({ organizationId, classId });

  } else {
    // FESTIVAL_GREETING
    recipients = await fetchAllStudentRecipients({ organizationId });
  }

  const recipientCount = recipients.length;
  const reminderType   = REMINDER_TYPE[campaignType];

  // ── Safety guardrail: threshold check ─────────────────────
  const threshold = checkThresholds(recipientCount);

  if (threshold.exceeded && confirmationToken !== CONFIRMATION_TOKEN) {
    // Create a PENDING_CONFIRMATION batch record for audit trail
    const batch = await createBatch({
      organizationId,
      batchType:      campaignType,
      recipientCount,
      status:         'PENDING_CONFIRMATION',
    });

    logger.warn('Campaign: batch requires confirmation — blocked', {
      organizationId,
      campaignType,
      recipientCount,
      estimatedCost:  threshold.estimatedCost,
      reasons:        threshold.reasons,
      batchId:        batch?.id,
    });

    return {
      confirmationRequired: true,
      batchId:              batch?.id,
      recipientCount,
      estimatedCost:        threshold.estimatedCost,
      maxRecipients:        threshold.maxRecipients,
      maxCostInr:           threshold.maxCostInr,
      reasons:              threshold.reasons,
      hint:                 `Resend with confirmationToken: "${CONFIRMATION_TOKEN}" to proceed.`,
    };
  }

  // ── Create RUNNING batch record ───────────────────────────
  const batch = await createBatch({
    organizationId,
    batchType:      campaignType,
    recipientCount,
    status:         'RUNNING',
  });

  logger.info('Campaign: batch started', {
    organizationId,
    campaignType,
    reminderType,
    recipientCount,
    estimatedCost: threshold.estimatedCost,
    batchId:       batch?.id,
  });

  // ── Fire-and-forget dispatch ──────────────────────────────
  setImmediate(() => {
    runCampaign({
      recipients,
      message:      message.trim(),
      organizationId,
      reminderType,
      batchId:      batch?.id,
    }).catch(async (err) => {
      await updateBatchStatus(batch?.id, 'FAILED');
      logger.error('Campaign: runCampaign unhandled error', {
        organizationId,
        campaignType,
        batchId: batch?.id,
        error:   err.message,
      });
    });
  });

  return {
    queued:        true,
    campaignType,
    reminderType,
    recipientCount,
    estimatedCost: threshold.estimatedCost,
    batchId:       batch?.id,
  };
}

module.exports = { launchCampaign };
