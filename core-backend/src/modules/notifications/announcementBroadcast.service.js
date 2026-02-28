'use strict';

const pool                       = require('../../config/db');
const logger                     = require('../../utils/logger');
const { sendWhatsAppMessage }    = require('../../utils/whatsapp.service');
const { logSuccess, logFailure } = require('../../workers/notificationLogs.service');
const { renderTemplate }         = require('../../utils/templateRenderer');
const {
  checkThresholds,
  createBatch,
  updateBatchStatus,
} = require('./messageBatch.service');

const CONFIRMATION_TOKEN = 'CONFIRM_SEND';

const VALID_FILTERS  = ['ALL_STUDENTS', 'CLASS', 'SECTION'];
const REMINDER_TYPE  = 'ANNOUNCEMENT';
const SEND_INTERVAL  = 300; // ms between sends

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// FETCH ANNOUNCEMENT TEMPLATE
// ============================================================

async function fetchAnnouncementTemplate(organizationId) {
  const { rows } = await pool.query(
    `SELECT message_template
     FROM   notification_templates
     WHERE  organization_id = $1
       AND  type            = 'ANNOUNCEMENT'
       AND  deleted_at IS NULL
     ORDER  BY created_at DESC
     LIMIT  1`,
    [organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('No ANNOUNCEMENT template found for this organization. Create one first.');
    err.statusCode = 404;
    throw err;
  }

  return rows[0].message_template;
}

// ============================================================
// FETCH TARGET CONTACTS
// Supports: ALL_STUDENTS | CLASS | SECTION
// Returns array of { studentId, father_mobile, mother_mobile }
// ============================================================

async function fetchTargetContacts({ organizationId, filter, classId, sectionId }) {
  let whereClause = `s.organization_id = $1 AND s.deleted_at IS NULL`;
  const params    = [organizationId];
  let   paramIdx  = 2;

  if (filter === 'CLASS' || filter === 'SECTION') {
    if (!classId) {
      const err = new Error('classId is required when filter is CLASS or SECTION');
      err.statusCode = 400;
      throw err;
    }

    whereClause += `
      AND EXISTS (
        SELECT 1 FROM student_enrollments se
        JOIN   classes c ON c.id = se.class_id AND c.deleted_at IS NULL
        WHERE  se.student_id      = s.id
          AND  se.organization_id = $1
          AND  se.class_id        = $${paramIdx++}
          AND  se.deleted_at IS NULL
      )`;
    params.push(classId);
  }

  if (filter === 'SECTION') {
    if (!sectionId) {
      const err = new Error('sectionId is required when filter is SECTION');
      err.statusCode = 400;
      throw err;
    }

    whereClause += `
      AND EXISTS (
        SELECT 1 FROM student_enrollments se2
        WHERE  se2.student_id      = s.id
          AND  se2.organization_id = $1
          AND  se2.section_id      = $${paramIdx++}
          AND  se2.deleted_at IS NULL
      )`;
    params.push(sectionId);
  }

  const { rows } = await pool.query(
    `SELECT id AS student_id, father_mobile, mother_mobile
     FROM   students s
     WHERE  ${whereClause}`,
    params
  );

  return rows;
}

// ============================================================
// SEND TO A SINGLE CONTACT (with logging — never throws)
// ============================================================

async function sendToContact({ organizationId, studentId, contactNumber, message }) {
  try {
    const result = await sendWhatsAppMessage(contactNumber, message);
    logSuccess({
      organizationId,
      studentId,
      feeId:         null,
      contactNumber,
      channel:       'WHATSAPP',
      message,
      reminderType:  REMINDER_TYPE,
      messageId:     result.messageId,
      attempts:      1,
    }).catch((e) => console.error('[Announcement] logSuccess error:', e.message));

    return { success: true, contactNumber };
  } catch (err) {
    logFailure({
      organizationId,
      studentId,
      feeId:         null,
      contactNumber,
      channel:       'WHATSAPP',
      message,
      reminderType:  REMINDER_TYPE,
      attempts:      1,
      errorMessage:  err.message,
    }).catch((e) => console.error('[Announcement] logFailure error:', e.message));

    return { success: false, contactNumber, error: err.message };
  }
}

// ============================================================
// BROADCAST RUNNER
// Called by the controller as fire-and-forget.
// ============================================================

async function runBroadcast({
  organizationId,
  templateText,
  title,
  organizationName,
  contacts,           // [{ studentId, father_mobile, mother_mobile }]
  batchId,
}) {
  const stats = { total: 0, sent: 0, failed: 0 };

  // Build rendered message once — same for all recipients
  let message;
  try {
    message = renderTemplate(templateText, {
      title:            title            || '',
      organizationName: organizationName || '',
    });
  } catch (err) {
    logger.error('Announcement: renderTemplate failed', { organizationId, batchId, error: err.message });
    await updateBatchStatus(batchId, 'FAILED');
    return stats;
  }

  // Deduplicate all contact numbers across all students
  const seen    = new Set();
  const sendMap = []; // [{ studentId, contactNumber }]

  for (const contact of contacts) {
    for (const num of [contact.father_mobile, contact.mother_mobile]) {
      if (num && !seen.has(num)) {
        seen.add(num);
        sendMap.push({ studentId: contact.student_id, contactNumber: num });
      }
    }
  }

  stats.total = sendMap.length;
  logger.info('Announcement: broadcast dispatch started', { organizationId, batchId, total: stats.total });

  for (const { studentId, contactNumber } of sendMap) {
    const result = await sendToContact({ organizationId, studentId, contactNumber, message });

    if (result.success) {
      stats.sent++;
    } else {
      stats.failed++;
      logger.warn('Announcement: send failed', { organizationId, batchId, contactNumber, error: result.error });
    }

    await sleep(SEND_INTERVAL);
  }

  await updateBatchStatus(batchId, 'COMPLETED');
  logger.info('Announcement: broadcast complete', { organizationId, batchId, ...stats });
  return stats;
}

// ============================================================
// MAIN: validate + resolve + kick off fire-and-forget
// ============================================================

/**
 * broadcastAnnouncement({ organizationId, organizationName, title, filter, classId, sectionId })
 *
 * Validates inputs, fetches template + contacts synchronously,
 * then dispatches the actual sends as a fire-and-forget background task.
 *
 * Returns immediately with { queued, recipientCount } so the HTTP
 * response is never delayed by send time.
 */
async function broadcastAnnouncement({
  organizationId,
  organizationName,
  title,
  filter,
  classId,
  sectionId,
  confirmationToken,
}) {
  // ── Validate filter ───────────────────────────────────────
  const normalizedFilter = (filter || 'ALL_STUDENTS').toUpperCase();
  if (!VALID_FILTERS.includes(normalizedFilter)) {
    const err = new Error(`Invalid filter. Allowed: ${VALID_FILTERS.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  // ── Fetch template (throws 404 if none) ──────────────────
  const templateText = await fetchAnnouncementTemplate(organizationId);

  // ── Fetch contacts ────────────────────────────────────────
  const contacts = await fetchTargetContacts({
    organizationId,
    filter: normalizedFilter,
    classId,
    sectionId,
  });

  if (contacts.length === 0) {
    return { queued: false, recipientCount: 0, reason: 'no_contacts_found' };
  }

  // ── Safety guardrail: threshold check ─────────────────────
  const recipientCount = contacts.length;
  const threshold      = checkThresholds(recipientCount);

  if (threshold.exceeded && confirmationToken !== CONFIRMATION_TOKEN) {
    const batch = await createBatch({
      organizationId,
      batchType:      'ANNOUNCEMENT',
      recipientCount,
      status:         'PENDING_CONFIRMATION',
    });

    logger.warn('Announcement: batch requires confirmation — blocked', {
      organizationId,
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
    batchType:      'ANNOUNCEMENT',
    recipientCount,
    status:         'RUNNING',
  });

  logger.info('Announcement: batch started', {
    organizationId,
    recipientCount,
    estimatedCost: threshold.estimatedCost,
    batchId:       batch?.id,
  });

  // ── Fire-and-forget broadcast ─────────────────────────────
  runBroadcast({
    organizationId,
    templateText,
    title:            title || '',
    organizationName: organizationName || '',
    contacts,
    batchId:          batch?.id,
  }).catch(async (err) => {
    await updateBatchStatus(batch?.id, 'FAILED');
    logger.error('Announcement: runBroadcast unhandled error', {
      organizationId,
      batchId: batch?.id,
      error:   err.message,
    });
  });

  return {
    queued:        true,
    recipientCount,
    estimatedCost: threshold.estimatedCost,
    batchId:       batch?.id,
  };
}

module.exports = { broadcastAnnouncement };
