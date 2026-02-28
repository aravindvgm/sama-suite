'use strict';

const pool                            = require('../config/db');
const { sendWhatsAppMessage }         = require('../utils/whatsapp.service');
const { logSuccess, logFailure }      = require('./notificationLogs.service');
const { renderTemplate }              = require('../utils/templateRenderer');

const REMINDER_TYPE    = 'BIRTHDAY';
const DEFAULT_TEMPLATE = 'Dear Parent, wishing {{studentName}} a very Happy Birthday! 🎂 From {{organizationName}}.';
const SEND_INTERVAL_MS = 300; // ms between sends to avoid gateway rate limits

// ============================================================
// HELPERS
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// FETCH TODAY'S BIRTHDAY STUDENTS
// Matches on month + day only — year-agnostic.
// ============================================================

async function fetchBirthdayStudents() {
  const { rows } = await pool.query(
    `SELECT
       s.id               AS student_id,
       s.organization_id,
       s.first_name,
       s.last_name,
       s.father_mobile,
       s.mother_mobile,
       s.primary_contact,
       o.name             AS organization_name,
       COALESCE(c.class_name, c.name, NULL) AS class_name
     FROM   students       s
     JOIN   organizations  o  ON o.id  = s.organization_id
     LEFT   JOIN student_enrollments se
               ON se.student_id      = s.id
              AND se.organization_id = s.organization_id
              AND se.deleted_at IS NULL
     LEFT   JOIN classes   c  ON c.id  = se.class_id AND c.deleted_at IS NULL
     WHERE  s.deleted_at IS NULL
       AND  EXTRACT(MONTH FROM s.date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
       AND  EXTRACT(DAY   FROM s.date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)
     ORDER  BY s.organization_id, s.id`,
    []
  );
  return rows;
}

// ============================================================
// FETCH BIRTHDAY TEMPLATES (one per org, most recent)
// ============================================================

async function fetchTemplateMap(orgIds) {
  if (orgIds.length === 0) return {};

  const { rows } = await pool.query(
    `SELECT organization_id, message_template
     FROM   notification_templates
     WHERE  organization_id = ANY($1::uuid[])
       AND  type            = 'BIRTHDAY'
       AND  deleted_at IS NULL
     ORDER  BY created_at DESC`,
    [orgIds]
  );

  const map = {};
  for (const t of rows) {
    if (!map[t.organization_id]) map[t.organization_id] = t.message_template;
  }
  return map;
}

// ============================================================
// SEND TO A SINGLE CONTACT (with logging)
// Never throws.
// ============================================================

async function sendToContact({ organizationId, studentId, contactNumber, message }) {
  try {
    const result = await sendWhatsAppMessage(contactNumber, message);
    await logSuccess({
      organizationId,
      studentId,
      feeId:         null,
      contactNumber,
      channel:       'WHATSAPP',
      message,
      reminderType:  REMINDER_TYPE,
      messageId:     result.messageId,
      attempts:      1,
    });
    return { success: true, messageId: result.messageId };
  } catch (err) {
    await logFailure({
      organizationId,
      studentId,
      feeId:         null,
      contactNumber,
      channel:       'WHATSAPP',
      message,
      reminderType:  REMINDER_TYPE,
      attempts:      1,
      errorMessage:  err.message,
    });
    return { success: false, error: err.message };
  }
}

// ============================================================
// CORE SERVICE
// ============================================================

/**
 * runBirthdayReminders()
 *
 * Fetches all students with today's birthday, resolves the org
 * template (or falls back to default), and sends a WhatsApp
 * message to BOTH father_mobile and mother_mobile where present.
 *
 * @returns {Promise<{ studentsFound, sent, failed, skipped }>}
 */
async function runBirthdayReminders() {
  const stats = { studentsFound: 0, sent: 0, failed: 0, skipped: 0 };

  // ── Step 1: Fetch birthday students ──────────────────────
  let students;
  try {
    students = await fetchBirthdayStudents();
  } catch (err) {
    console.error('[BirthdayReminder] Failed to fetch birthday students:', err.message);
    throw err; // re-throw so worker can capture it
  }

  stats.studentsFound = students.length;

  if (students.length === 0) {
    console.log('[BirthdayReminder] No birthdays today.');
    return stats;
  }

  // ── Step 2: Fetch templates per org ──────────────────────
  const orgIds     = [...new Set(students.map((s) => s.organization_id))];
  let templateMap  = {};
  try {
    templateMap = await fetchTemplateMap(orgIds);
  } catch (err) {
    // Non-fatal — fall through to default template for all orgs
    console.error('[BirthdayReminder] Failed to fetch templates (using defaults):', err.message);
  }

  // ── Step 3: Send to each student's contacts ───────────────
  for (const student of students) {
    const studentName = `${student.first_name} ${student.last_name}`.trim();

    const templateText = templateMap[student.organization_id] || DEFAULT_TEMPLATE;

    let message;
    try {
      message = renderTemplate(templateText, {
        studentName,
        className:        student.class_name        || '',
        organizationName: student.organization_name || '',
      });
    } catch (err) {
      console.error(`[BirthdayReminder] renderTemplate failed for student=${student.student_id}:`, err.message);
      stats.skipped++;
      continue;
    }

    // Collect distinct non-null contacts for this student
    const contacts = [...new Set(
      [student.father_mobile, student.mother_mobile].filter(Boolean)
    )];

    if (contacts.length === 0) {
      console.warn(`[BirthdayReminder] No contacts for student=${student.student_id} — skipping`);
      stats.skipped++;
      continue;
    }

    for (const contactNumber of contacts) {
      try {
        const result = await sendToContact({
          organizationId: student.organization_id,
          studentId:      student.student_id,
          contactNumber,
          message,
        });

        if (result.success) {
          stats.sent++;
          console.log(
            `[BirthdayReminder] ✓ Sent → ${contactNumber} (student=${student.student_id} msgId=${result.messageId})`
          );
        } else {
          stats.failed++;
          console.error(
            `[BirthdayReminder] ✗ Failed → ${contactNumber} (student=${student.student_id}): ${result.error}`
          );
        }
      } catch (err) {
        // sendToContact should never throw, but guard regardless
        stats.failed++;
        console.error(`[BirthdayReminder] Unexpected error for student=${student.student_id}:`, err.message);
      }

      await sleep(SEND_INTERVAL_MS);
    }
  }

  return stats;
}

module.exports = { runBirthdayReminders };
