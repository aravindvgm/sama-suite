'use strict';

const pool = require('../../config/db');

/**
 * getSummary({ organizationId })
 *
 * Returns today's notification counts grouped by status and reminder_type.
 * Single query — all aggregations in one pass.
 */
async function getSummary({ organizationId }) {
  const { rows } = await pool.query(
    `SELECT
       -- Overall today
       COUNT(*)                                                           AS total_today,
       COUNT(*) FILTER (WHERE status = 'SUCCESS')                        AS today_sent,
       COUNT(*) FILTER (WHERE status = 'FAILED')                         AS today_failed,

       -- By reminder_type (SUCCESS only)
       COUNT(*) FILTER (WHERE status = 'SUCCESS' AND reminder_type = 'BIRTHDAY')     AS birthday_sent_today,
       COUNT(*) FILTER (WHERE status = 'SUCCESS' AND reminder_type = 'ANNOUNCEMENT') AS announcement_sent_today,
       COUNT(*) FILTER (WHERE status = 'SUCCESS' AND reminder_type = 'FEE_REMINDER') AS fee_reminder_sent_today
     FROM   notification_logs
     WHERE  organization_id = $1
       AND  DATE(created_at) = CURRENT_DATE`,
    [organizationId]
  );

  const row = rows[0];

  return {
    todaySent:             parseInt(row.today_sent,              10),
    todayFailed:           parseInt(row.today_failed,            10),
    birthdaySentToday:     parseInt(row.birthday_sent_today,     10),
    announcementSentToday: parseInt(row.announcement_sent_today, 10),
    feeReminderSentToday:  parseInt(row.fee_reminder_sent_today, 10),
  };
}

module.exports = { getSummary };
