'use strict';

/**
 * riskNotification.worker.js
 *
 * Phase-9.A — Awareness-only email notifications for security risk cases.
 *
 * Runs every 10 minutes (or every N minutes from jobScheduler).
 * Evaluates OPEN risk cases and sends email alerts to org_security_contacts
 * when the case matches the organization's org_risk_policy.
 *
 * AWARENESS ONLY — this worker:
 *   ✓ Sends awareness emails to designated security contacts
 *   ✓ Records every attempt in risk_notifications (SENT / FAILED / SKIPPED)
 *   ✓ Stamps notification_evaluated_at so cases are not re-evaluated until
 *     their updated_at advances (i.e. the risk score changes)
 *   ✗ Does NOT revoke sessions or tokens
 *   ✗ Does NOT close or modify risk cases
 *   ✗ Does NOT enforce any policy action
 *   ✗ Does NOT expose PII: no IP addresses, API paths, phone numbers,
 *     student records, financial data, or device fingerprints
 *
 * Multi-instance behavior:
 *   When invoked from jobScheduler.worker.js the distributed job lock ensures
 *   only one instance runs per cycle.  In standalone mode each instance runs
 *   independently; the notification_evaluated_at stamp prevents duplicate sends
 *   within the same updated_at window.
 *
 * Failure behavior:
 *   - DB unavailable → cycle skipped, warning logged, worker continues.
 *   - Per-case error → isolated by try/catch; other cases still processed.
 *   - SMTP failure → recorded as 'FAILED' in risk_notifications; does not
 *     crash the worker or block other contacts/cases.
 *   - nodemailer absent → all sends degrade to { ok: false, NODEMAILER_NOT_INSTALLED }.
 *
 * Usage (standalone):
 *   node src/workers/riskNotification.worker.js
 *
 * Usage (from jobScheduler — preferred):
 *   const { runRiskNotification } = require('./riskNotification.worker');
 *   runJob('risk_notification', runRiskNotification);
 *
 * Example queries used by this worker:
 *
 *   -- Fetch cases needing evaluation:
 *   SELECT rc.id, rc.organization_id, rc.user_id, rc.peak_risk_level,
 *          rc.peak_risk_score, rc.signals, rc.opened_at,
 *          rc.user_display_name, rc.user_role_label, o.name AS organization_name
 *     FROM risk_cases rc
 *     JOIN organizations o ON o.id = rc.organization_id
 *    WHERE rc.status = 'OPEN'
 *      AND (rc.notification_evaluated_at IS NULL
 *           OR rc.updated_at > rc.notification_evaluated_at)
 *    ORDER BY rc.opened_at ASC
 *    LIMIT $1;
 *
 *   -- Per-org cooldown check:
 *   SELECT 1 FROM risk_notifications
 *    WHERE organization_id = $1 AND status = 'SENT'
 *      AND created_at > NOW() - ($2 * INTERVAL '1 minute')
 *    LIMIT 1;
 *
 *   -- Last SENT notification for this case (score-increase detection):
 *   SELECT risk_score_at_send FROM risk_notifications
 *    WHERE case_id = $1 AND status = 'SENT' AND notification_type = 'EMAIL'
 *    ORDER BY created_at DESC LIMIT 1;
 */

require('dotenv').config();

const pool            = require('../config/db');
const logger          = require('../utils/logger');
const { sendEmail }   = require('../utils/email.service');
const { renderEmail } = require('../modules/security/riskEmail.renderer');

const WORKER_NAME = 'riskNotification';
const INTERVAL_MS = 10 * 60 * 1000;  // 10 minutes
const BATCH_LIMIT = 50;              // max cases processed per cycle

// ── Risk level ordering for minimum_risk_level comparison ─────────────────────

const LEVEL_ORDER = { NORMAL: 0, ELEVATED: 1, HIGH: 2, CRITICAL: 3 };

function _meetsMinimum(caseLevel, policyMinimum) {
  return (LEVEL_ORDER[caseLevel] || 0) >= (LEVEL_ORDER[policyMinimum] || 0);
}

// ── Private: user identity snapshot ──────────────────────────────────────────

/**
 * Populate user_display_name and user_role_label on a risk case if they are
 * currently NULL.  Uses a single LEFT JOIN query; gracefully handles users
 * that have been deactivated (returns 'Unknown User' / 'Unknown Role').
 *
 * No-op if both snapshot columns are already set.
 *
 * @param {string} caseId
 * @param {string} userId
 * @param {string} organizationId
 */
async function _ensureUserSnapshot(caseId, userId, organizationId) {
  const { rows } = await pool.query(
    `SELECT u.full_name AS display_name,
            r.name      AS role_label
       FROM users u
       LEFT JOIN user_memberships um
              ON um.user_id         = u.id
             AND um.organization_id = $2
             AND um.status          = 'active'
       LEFT JOIN roles r ON r.id = um.role_id
      WHERE u.id        = $1
        AND u.is_active = true
      LIMIT 1`,
    [userId, organizationId]
  );

  const displayName = (rows.length > 0 && rows[0].display_name)
    ? rows[0].display_name
    : 'Unknown User';
  const roleLabel = (rows.length > 0 && rows[0].role_label)
    ? rows[0].role_label
    : 'Unknown Role';

  await pool.query(
    `UPDATE risk_cases
        SET user_display_name = COALESCE(user_display_name, $2),
            user_role_label   = COALESCE(user_role_label,   $3)
      WHERE id = $1`,
    [caseId, displayName, roleLabel]
  );

  return { displayName, roleLabel };
}

// ── Private: stamp evaluation timestamp ───────────────────────────────────────

/**
 * Mark a case as evaluated at the current time.
 * Prevents re-evaluation until the case's updated_at advances.
 *
 * Always called — even when the worker decides to SKIP sending,
 * to avoid a tight re-evaluation loop on cases that consistently
 * fail policy checks.
 *
 * @param {string} caseId
 */
async function _markEvaluated(caseId) {
  await pool.query(
    `UPDATE risk_cases
        SET notification_evaluated_at = NOW()
      WHERE id = $1`,
    [caseId]
  );
}

// ── Private: insert notification audit record ─────────────────────────────────

/**
 * Insert one row into risk_notifications.
 * Never throws — errors are logged and suppressed so a failed insert
 * does not abort the enclosing case processing loop.
 *
 * @param {object} record
 */
async function _insertNotificationRecord(record) {
  try {
    await pool.query(
      `INSERT INTO risk_notifications
         (organization_id, case_id, notification_type, status,
          recipient_email, subject, risk_score_at_send, skip_reason, fail_reason)
       VALUES ($1, $2, 'EMAIL', $3, $4, $5, $6, $7, $8)`,
      [
        record.organizationId,
        record.caseId,
        record.status,
        record.recipientEmail  || null,
        record.subject         || null,
        record.riskScoreAtSend !== undefined ? record.riskScoreAtSend : null,
        record.skipReason      || null,
        record.failReason      || null,
      ]
    );
  } catch (err) {
    logger.error(`${WORKER_NAME}: failed to insert notification record`, {
      caseId: record.caseId,
      status: record.status,
      error:  err.message,
    });
  }
}

// ── Core run function ─────────────────────────────────────────────────────────

/**
 * Execute one full notification evaluation cycle.
 *
 * @returns {Promise<{
 *   casesEvaluated: number,
 *   emailsSent:     number,
 *   emailsFailed:   number,
 *   emailsSkipped:  number,
 *   errors:         number,
 *   durationMs:     number
 * }>}
 */
async function runRiskNotification() {
  const startedAt    = Date.now();
  let casesEvaluated = 0;
  let emailsSent     = 0;
  let emailsFailed   = 0;
  let emailsSkipped  = 0;
  let errors         = 0;

  logger.info(`${WORKER_NAME}: starting evaluation cycle`);

  // ── Step 1: Fetch OPEN cases needing evaluation ────────────────────────────
  // Cases where notification_evaluated_at IS NULL (new case) or where the case
  // has been updated (risk refreshed) since the last evaluation.

  let cases;

  try {
    const { rows } = await pool.query(
      `SELECT rc.id,
              rc.organization_id,
              rc.user_id,
              rc.peak_risk_level,
              rc.peak_risk_score,
              rc.signals,
              rc.opened_at,
              rc.user_display_name,
              rc.user_role_label,
              o.name AS organization_name
         FROM risk_cases rc
         JOIN organizations o ON o.id = rc.organization_id
        WHERE rc.status = 'OPEN'
          AND (
            rc.notification_evaluated_at IS NULL
            OR rc.updated_at > rc.notification_evaluated_at
          )
        ORDER BY rc.opened_at ASC
        LIMIT $1`,
      [BATCH_LIMIT]
    );
    cases = rows;
  } catch (err) {
    logger.error(`${WORKER_NAME}: failed to fetch pending cases — DB may be unavailable`, {
      error: err.message,
    });
    return {
      casesEvaluated: 0,
      emailsSent:     0,
      emailsFailed:   0,
      emailsSkipped:  0,
      errors:         1,
      durationMs:     Date.now() - startedAt,
    };
  }

  if (cases.length === 0) {
    logger.info(`${WORKER_NAME}: no cases pending evaluation`);
    return {
      casesEvaluated: 0,
      emailsSent:     0,
      emailsFailed:   0,
      emailsSkipped:  0,
      errors:         0,
      durationMs:     Date.now() - startedAt,
    };
  }

  // ── Step 2: Process each case ──────────────────────────────────────────────

  for (const rc of cases) {
    casesEvaluated++;

    try {
      // ── 2a. Ensure user identity snapshot ──────────────────────────────────
      // Populate user_display_name / user_role_label if not already set.
      // The worker mutates rc so subsequent steps use the populated values.

      if (!rc.user_display_name || !rc.user_role_label) {
        const snap = await _ensureUserSnapshot(
          rc.id,
          rc.user_id,
          rc.organization_id
        );
        rc.user_display_name = snap.displayName;
        rc.user_role_label   = snap.roleLabel;
      }

      // ── 2b. Load org policy ────────────────────────────────────────────────
      // Absent policy row = notifications disabled for this org.

      const { rows: policyRows } = await pool.query(
        `SELECT minimum_risk_level,
                notification_cooldown_minutes,
                notify_on_new_case,
                notify_on_risk_increase,
                is_enabled
           FROM org_risk_policy
          WHERE organization_id = $1`,
        [rc.organization_id]
      );

      if (policyRows.length === 0 || !policyRows[0].is_enabled) {
        await _markEvaluated(rc.id);
        await _insertNotificationRecord({
          organizationId: rc.organization_id,
          caseId:         rc.id,
          status:         'SKIPPED',
          skipReason:     policyRows.length === 0 ? 'NO_POLICY' : 'POLICY_DISABLED',
        });
        emailsSkipped++;
        continue;
      }

      const policy = policyRows[0];

      // ── 2c. Check peak_risk_level meets policy minimum ─────────────────────
      // Use peak_risk_level (monotonically increasing) — not current risk_level
      // which can decay.  This ensures we notify for the worst the case reached.

      if (!_meetsMinimum(rc.peak_risk_level, policy.minimum_risk_level)) {
        await _markEvaluated(rc.id);
        await _insertNotificationRecord({
          organizationId: rc.organization_id,
          caseId:         rc.id,
          status:         'SKIPPED',
          skipReason:     'LEVEL_BELOW_MINIMUM',
        });
        emailsSkipped++;
        continue;
      }

      // ── 2d. Load active contacts ───────────────────────────────────────────

      const { rows: contacts } = await pool.query(
        `SELECT contact_name, contact_email
           FROM org_security_contacts
          WHERE organization_id = $1
            AND is_active = true`,
        [rc.organization_id]
      );

      if (contacts.length === 0) {
        await _markEvaluated(rc.id);
        await _insertNotificationRecord({
          organizationId: rc.organization_id,
          caseId:         rc.id,
          status:         'SKIPPED',
          skipReason:     'NO_CONTACTS',
        });
        emailsSkipped++;
        continue;
      }

      // ── 2e. Per-org cooldown check ─────────────────────────────────────────
      // One SENT notification per org within the cooldown window blocks ALL
      // cases for that org. Prevents alert storms when multiple users spike.

      const { rows: cooldownRows } = await pool.query(
        `SELECT 1
           FROM risk_notifications
          WHERE organization_id = $1
            AND status          = 'SENT'
            AND created_at      > NOW() - ($2 * INTERVAL '1 minute')
          LIMIT 1`,
        [rc.organization_id, policy.notification_cooldown_minutes]
      );

      if (cooldownRows.length > 0) {
        await _markEvaluated(rc.id);
        await _insertNotificationRecord({
          organizationId: rc.organization_id,
          caseId:         rc.id,
          status:         'SKIPPED',
          skipReason:     'COOLDOWN_ACTIVE',
        });
        emailsSkipped++;
        continue;
      }

      // ── 2f. Decide whether to send ─────────────────────────────────────────
      // Check the last SENT notification for this case (if any) to determine:
      //   - No prior notification → apply notify_on_new_case
      //   - Has prior notification → apply notify_on_risk_increase + score check

      const { rows: priorRows } = await pool.query(
        `SELECT risk_score_at_send
           FROM risk_notifications
          WHERE case_id           = $1
            AND status            = 'SENT'
            AND notification_type = 'EMAIL'
          ORDER BY created_at DESC
          LIMIT 1`,
        [rc.id]
      );

      const hasPriorNotification = priorRows.length > 0;

      if (!hasPriorNotification) {
        // New case — respect notify_on_new_case
        if (!policy.notify_on_new_case) {
          await _markEvaluated(rc.id);
          await _insertNotificationRecord({
            organizationId: rc.organization_id,
            caseId:         rc.id,
            status:         'SKIPPED',
            skipReason:     'NOTIFY_ON_NEW_CASE_DISABLED',
          });
          emailsSkipped++;
          continue;
        }
      } else {
        // Existing case — check notify_on_risk_increase
        if (!policy.notify_on_risk_increase) {
          await _markEvaluated(rc.id);
          await _insertNotificationRecord({
            organizationId: rc.organization_id,
            caseId:         rc.id,
            status:         'SKIPPED',
            skipReason:     'NOTIFY_ON_RISK_INCREASE_DISABLED',
          });
          emailsSkipped++;
          continue;
        }

        // Only send if peak_risk_score has increased since the last notification.
        const lastScore = priorRows[0].risk_score_at_send;
        if (lastScore !== null && rc.peak_risk_score <= lastScore) {
          await _markEvaluated(rc.id);
          await _insertNotificationRecord({
            organizationId: rc.organization_id,
            caseId:         rc.id,
            status:         'SKIPPED',
            skipReason:     'NO_RISK_INCREASE',
          });
          emailsSkipped++;
          continue;
        }
      }

      // ── 2g. Render email ───────────────────────────────────────────────────

      const { subject, html, text } = renderEmail({
        organizationName: rc.organization_name,
        userDisplayName:  rc.user_display_name,
        userRoleLabel:    rc.user_role_label,
        peakRiskLevel:    rc.peak_risk_level,
        peakRiskScore:    rc.peak_risk_score,
        signals:          rc.signals,
        openedAt:         rc.opened_at,
      });

      // ── 2h–2i. Send to each contact and record outcome ────────────────────
      // Contacts are processed sequentially to honour SMTP rate limits.
      // A failure on one contact does not block the others.

      for (const contact of contacts) {
        const result = await sendEmail({
          to:      contact.contact_email,
          subject,
          html,
          text,
        });

        await _insertNotificationRecord({
          organizationId:   rc.organization_id,
          caseId:           rc.id,
          status:           result.ok ? 'SENT' : 'FAILED',
          recipientEmail:   contact.contact_email,
          subject,
          riskScoreAtSend:  rc.peak_risk_score,
          failReason:       result.ok ? null : result.reason,
        });

        if (result.ok) {
          emailsSent++;
        } else {
          emailsFailed++;
          logger.warn(`${WORKER_NAME}: email delivery failed`, {
            caseId:    rc.id,
            recipient: contact.contact_email,
            reason:    result.reason,
          });
        }
      }

      // ── 2j. Stamp evaluation timestamp ────────────────────────────────────

      await _markEvaluated(rc.id);

    } catch (err) {
      errors++;
      logger.error(`${WORKER_NAME}: error processing case`, {
        caseId: rc.id,
        error:  err.message,
      });

      // Still mark evaluated to prevent a tight re-evaluation loop on a
      // persistently failing case. The case will be re-evaluated on the next
      // cycle if updated_at changes (i.e. riskCase.worker refreshes scores).
      try {
        await _markEvaluated(rc.id);
      } catch (_) {
        // Ignore secondary failure — DB may be unavailable.
      }
    }
  }

  const durationMs = Date.now() - startedAt;

  logger.info(`${WORKER_NAME}: cycle complete`, {
    casesEvaluated,
    emailsSent,
    emailsFailed,
    emailsSkipped,
    errors,
    durationMs,
  });

  return { casesEvaluated, emailsSent, emailsFailed, emailsSkipped, errors, durationMs };
}

// ── Standalone execution ──────────────────────────────────────────────────────

if (require.main === module) {
  runRiskNotification();

  const timer = setInterval(runRiskNotification, INTERVAL_MS);

  logger.info(`${WORKER_NAME}: worker started in standalone mode`, {
    intervalMs: INTERVAL_MS,
  });

  async function shutdown(signal) {
    logger.info(`${WORKER_NAME}: shutting down`, { signal });
    clearInterval(timer);
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error(`${WORKER_NAME}: uncaught exception (process continues)`, {
      error: err.message,
      stack: err.stack,
    });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error(`${WORKER_NAME}: unhandled rejection (process continues)`, {
      reason: String(reason),
    });
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { runRiskNotification };
