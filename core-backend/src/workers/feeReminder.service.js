'use strict';

const pool                   = require('../config/db');
const { renderTemplate }     = require('../utils/templateRenderer');

const UPCOMING_DAYS = 3; // remind if due within this many days

// ============================================================
// HELPERS
// ============================================================

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function resolveContactNumber(student) {
  const primary = (student.primary_contact || 'FATHER').toUpperCase();
  if (primary === 'MOTHER' && student.mother_mobile) return student.mother_mobile;
  if (primary === 'FATHER' && student.father_mobile) return student.father_mobile;
  // Fallback: try either number
  return student.father_mobile || student.mother_mobile || null;
}

function buildMessage({ reminderType, studentName, feeAmount, dueDate }) {
  const amountStr = Number(feeAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 });
  const dateStr   = formatDate(dueDate);

  if (reminderType === 'UPCOMING') {
    return `Dear Parent, fee of ₹${amountStr} for ${studentName} is due on ${dateStr}. Kindly pay before due date.`;
  }
  return `Dear Parent, fee of ₹${amountStr} for ${studentName} is overdue since ${dateStr}. Kindly pay immediately.`;
}

// ============================================================
// CORE: fetch unpaid fees and build reminder payloads
// ============================================================

async function buildFeeReminders() {
  const today    = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = new Date(today);
  upcoming.setDate(upcoming.getDate() + UPCOMING_DAYS);

  // Fetch all unpaid, non-deleted fees that are overdue or due within 3 days
  const { rows: fees } = await pool.query(
    `SELECT
       sf.id                AS fee_id,
       sf.organization_id,
       sf.student_id,
       sf.fee_structure_id,
       sf.amount            AS fee_amount,
       sf.due_date,
       sf.status            AS fee_status,
       fs.fee_name,
       o.name               AS org_name
     FROM   student_fees   sf
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     JOIN   organizations  o  ON o.id  = sf.organization_id
     WHERE  sf.status      != 'PAID'
       AND  sf.deleted_at IS NULL
       AND  sf.due_date   <= $1`,   -- due_date <= upcoming covers both overdue and next-3-days
    [upcoming.toISOString().split('T')[0]]
  );

  if (fees.length === 0) return [];

  // Fetch FEE_REMINDER templates once per distinct org (keyed by org ID)
  const orgIds = [...new Set(fees.map((f) => f.organization_id))];
  const { rows: templateRows } = await pool.query(
    `SELECT organization_id, message_template
     FROM   notification_templates
     WHERE  organization_id = ANY($1::uuid[])
       AND  type            = 'FEE_REMINDER'
       AND  deleted_at IS NULL
     ORDER  BY created_at DESC`,
    [orgIds]
  );
  // Use the most-recently-created template per org (first match wins after DESC sort)
  const templateMap = {};
  for (const t of templateRows) {
    if (!templateMap[t.organization_id]) templateMap[t.organization_id] = t.message_template;
  }

  // Fetch total SUCCESS payments per fee (to compute balance)
  const feeIds          = [...new Set(fees.map((f) => f.fee_id))];
  const { rows: sums }  = await pool.query(
    `SELECT student_fee_id, COALESCE(SUM(amount), 0) AS total_paid
     FROM   payments
     WHERE  student_fee_id  = ANY($1)
       AND  status          = 'SUCCESS'
       AND  deleted_at IS NULL
     GROUP  BY student_fee_id`,
    [feeIds]
  );

  const paidMap = {};
  for (const row of sums) {
    paidMap[row.student_fee_id] = parseFloat(row.total_paid);
  }

  // Fetch student contact details for all distinct student IDs
  const studentIds          = [...new Set(fees.map((f) => f.student_id))];
  const { rows: students }  = await pool.query(
    `SELECT id, first_name, last_name,
            father_mobile, mother_mobile, primary_contact
     FROM   students
     WHERE  id = ANY($1)
       AND  deleted_at IS NULL`,
    [studentIds]
  );

  const studentMap = {};
  for (const s of students) studentMap[s.id] = s;

  // Build reminder payloads
  const reminders = [];

  for (const fee of fees) {
    try {
      const student = studentMap[fee.student_id];
      if (!student) continue;

      const contactNumber = resolveContactNumber(student);
      if (!contactNumber) continue; // no contact — skip safely

      const totalPaid    = paidMap[fee.fee_id] || 0;
      const balance      = Math.max(0, parseFloat(fee.fee_amount) - totalPaid);
      if (balance <= 0) continue; // fully paid despite status lag — skip

      const dueDate      = new Date(fee.due_date);
      dueDate.setHours(0, 0, 0, 0);
      const reminderType = dueDate < today ? 'OVERDUE' : 'UPCOMING';

      const studentName  = `${student.first_name} ${student.last_name}`.trim();

      const customTemplate = templateMap[fee.organization_id];
      const message = customTemplate
        ? renderTemplate(customTemplate, {
            studentName,
            balance:          balance.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
            dueDate:          formatDate(fee.due_date),
            feeName:          fee.fee_name,
            organizationName: fee.org_name,
          })
        : buildMessage({ reminderType, studentName, feeAmount: balance, dueDate: fee.due_date });

      const messagePayload = {
        message,
        studentName,
        feeName:      fee.fee_name,
        feeAmount:    parseFloat(fee.fee_amount),
        balance,
        dueDate:      fee.due_date,
        orgName:      fee.org_name,
        reminderType,
      };

      reminders.push({
        organizationId:  fee.organization_id,
        studentId:       fee.student_id,
        feeId:           fee.fee_id,
        contactNumber,
        reminderType,
        messagePayload,
      });
    } catch (rowErr) {
      console.error(`[FeeReminder] Skipping fee ${fee.fee_id} due to error:`, rowErr.message);
    }
  }

  return reminders;
}

module.exports = { buildFeeReminders };
