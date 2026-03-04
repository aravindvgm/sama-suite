'use strict';

/**
 * jobScheduler.worker.js
 *
 * Production cron scheduler with PostgreSQL-backed distributed locking.
 * Safe to run on multiple server instances — only one will execute per job.
 *
 * Schedule:
 *   02:00        — auditIntegrity.worker
 *   03:00        — stepUpTokenPrune.worker (Phase-9.B)
 *   07:30        — principalDailyBriefing.worker
 *   08:00        — birthdayReminder.worker
 *   08:30        — notificationDispatcher.worker
 *   every 5min   — securityObservability.worker
 *   every 10min  — riskNotification.worker (Phase-9.A)
 *   every 15min  — behavioralRisk.worker + riskCase.worker
 *   every 30min  — notificationRetry.worker
 *
 * Lock mechanism:
 *   INSERT ... ON CONFLICT (job_name) DO UPDATE ... WHERE expires_at < NOW()
 *   Atomically acquires the lock only if no unexpired lock exists.
 *   Lock TTL = 30 minutes (covers worst-case job run time).
 *
 * Usage:
 *   node src/workers/jobScheduler.worker.js
 */

require('dotenv').config();

const cron         = require('node-cron');
const os           = require('os');
const pool         = require('../config/db');
const logger       = require('../utils/logger');
const auditService = require('../utils/auditService');

const { runBirthdayWorker }           = require('./birthdayReminder.worker');
const { runNotificationDispatcher }   = require('./notificationDispatcher.worker');
const { runNotificationRetry }        = require('./notificationRetry.worker');
const { runPrincipalDailyBriefing }   = require('./principalDailyBriefing.worker');
const { runAuditIntegrity }           = require('./auditIntegrity.worker');
const { runSecurityObservability }    = require('./securityObservability.worker');
const { runBehavioralRisk }          = require('./behavioralRisk.worker');
const { runRiskCaseSync }            = require('./riskCase.worker');
const { runRiskNotification }        = require('./riskNotification.worker');
const { runStepUpTokenPrune }        = require('./stepUpTokenPrune.worker');

// ============================================================
// IDENTITY
// ============================================================

const INSTANCE_ID      = `${os.hostname()}:${process.pid}`;
const LOCK_TTL_MINUTES = 30;

// ============================================================
// DISTRIBUTED LOCK
// ============================================================

/**
 * tryAcquireLock(jobName)
 *
 * Atomically inserts or updates the lock row.
 * Succeeds only if:
 *   - No lock row exists yet, OR
 *   - Existing lock has expired (expires_at < NOW())
 *
 * Returns true if this instance acquired the lock, false otherwise.
 * Never throws — returns false on DB error (fail-safe).
 */
async function tryAcquireLock(jobName) {
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO job_locks (job_name, locked_by, locked_at, expires_at)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '${LOCK_TTL_MINUTES} minutes')
       ON CONFLICT (job_name) DO UPDATE
         SET locked_by  = EXCLUDED.locked_by,
             locked_at  = EXCLUDED.locked_at,
             expires_at = EXCLUDED.expires_at
         WHERE job_locks.expires_at < NOW()`,
      [jobName, INSTANCE_ID]
    );
    return rowCount > 0;
  } catch (err) {
    logger.error('Scheduler: lock acquire failed', {
      jobName,
      instanceId: INSTANCE_ID,
      error: err.message,
    });
    return false;
  }
}

/**
 * releaseLock(jobName, status)
 *
 * Stamps last_run_at + last_run_status and clears the expiry so
 * other instances can immediately pick up the next run.
 * Never throws.
 */
async function releaseLock(jobName, status) {
  try {
    await pool.query(
      `UPDATE job_locks
       SET last_run_at     = NOW(),
           last_run_status = $1,
           expires_at      = NOW()       -- expire immediately so next run is unblocked
       WHERE job_name  = $2
         AND locked_by = $3`,
      [status, jobName, INSTANCE_ID]
    );
  } catch (err) {
    logger.error('Scheduler: lock release failed', {
      jobName,
      instanceId: INSTANCE_ID,
      error: err.message,
    });
  }
}

// ============================================================
// GUARDED JOB RUNNER
// ============================================================

/**
 * runJob(jobName, fn)
 *
 * Wraps a worker function with:
 *   1. Distributed lock acquisition
 *   2. Structured start/finish logging
 *   3. Error containment — process is never crashed
 */
async function runJob(jobName, fn) {
  const acquired = await tryAcquireLock(jobName);

  if (!acquired) {
    logger.info('Scheduler: lock held by another instance — skipping', {
      jobName,
      instanceId: INSTANCE_ID,
    });
    return;
  }

  const startedAt = Date.now();
  logger.info('Scheduler: job started', {
    jobName,
    instanceId: INSTANCE_ID,
  });

  let status = 'SUCCESS';

  try {
    await fn();
  } catch (err) {
    status = 'FAILED';
    logger.error('Scheduler: job failed', {
      jobName,
      instanceId: INSTANCE_ID,
      error: err.message,
    });
    // Non-blocking audit for job failures — cross-org, no organizationId
    auditService.logAction({
      organizationId: null,
      actorType:      'SYSTEM',
      action:         'JOB_FAILED',
      entityType:     'JOB',
      entityId:       jobName,
      meta: {
        instanceId: INSTANCE_ID,
        error:      err.message,
      },
    }).catch(() => {});
  } finally {
    const durationMs = Date.now() - startedAt;
    logger.info('Scheduler: job finished', {
      jobName,
      instanceId: INSTANCE_ID,
      status,
      durationMs,
    });
    await releaseLock(jobName, status);
  }
}

// ============================================================
// CRON JOBS
// ============================================================

const TZ = process.env.CRON_TIMEZONE || 'Asia/Kolkata';

// 07:30 — Principal daily voice briefing
cron.schedule('0 7 * * *', () => {
  runJob('principal_daily_briefing', runPrincipalDailyBriefing).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'principal_daily_briefing',
      error: err.message,
    })
  );
}, { timezone: TZ });

// 08:00 — Birthday reminders
cron.schedule('0 8 * * *', () => {
  runJob('birthday_reminder', runBirthdayWorker).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'birthday_reminder',
      error: err.message,
    })
  );
}, { timezone: TZ });

// 08:30 — Fee reminder / notification dispatcher
cron.schedule('30 8 * * *', () => {
  runJob('notification_dispatcher', runNotificationDispatcher).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'notification_dispatcher',
      error: err.message,
    })
  );
}, { timezone: TZ });

// 02:00 — Audit hash-chain integrity verification
cron.schedule('0 2 * * *', () => {
  runJob('audit_integrity', runAuditIntegrity).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'audit_integrity',
      error: err.message,
    })
  );
}, { timezone: TZ });

// every 30 min — retry failed notifications (attempts < 3)
cron.schedule('*/30 * * * *', () => {
  runJob('notification_retry', runNotificationRetry).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'notification_retry',
      error: err.message,
    })
  );
}, { timezone: TZ });

// every 5 min — Phase-8 security observability signals
cron.schedule('*/5 * * * *', () => {
  runJob('security_observability', runSecurityObservability).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'security_observability',
      error: err.message,
    })
  );
}, { timezone: TZ });

// every 15 min — Phase-8.5 behavioral risk & data access observability
cron.schedule('*/15 * * * *', () => {
  runJob('behavioral_risk', runBehavioralRisk).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'behavioral_risk',
      error: err.message,
    })
  );
}, { timezone: TZ });

// every 15 min — Phase-8.7 risk-case synchronisation (offset 7 min to avoid
// simultaneous execution with behavioral_risk on the same scheduler instance)
cron.schedule('7-59/15 * * * *', () => {
  runJob('risk_case_sync', runRiskCaseSync).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'risk_case_sync',
      error: err.message,
    })
  );
}, { timezone: TZ });

// every 10 min — Phase-9.A awareness email notifications for risk cases
cron.schedule('*/10 * * * *', () => {
  runJob('risk_notification', runRiskNotification).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'risk_notification',
      error: err.message,
    })
  );
}, { timezone: TZ });

// 03:00 daily — Phase-9.B step-up token prune (delete expired endpoint_stepup_tokens)
cron.schedule('0 3 * * *', () => {
  runJob('stepup_token_prune', runStepUpTokenPrune).catch((err) =>
    logger.error('Scheduler: unhandled rejection in job', {
      jobName: 'stepup_token_prune',
      error: err.message,
    })
  );
}, { timezone: TZ });

// ============================================================
// STARTUP
// ============================================================

logger.info('Scheduler: job scheduler started', {
  instanceId: INSTANCE_ID,
  timezone:   TZ,
  jobs: [
    'audit_integrity          — daily 02:00',
    'principal_daily_briefing — daily 07:30',
    'birthday_reminder        — daily 08:00',
    'notification_dispatcher  — daily 08:30',
    'notification_retry       — every 30 minutes',
    'security_observability   — every 5 minutes',
    'behavioral_risk          — every 15 minutes',
    'risk_case_sync           — every 15 minutes (offset :07)',
    'risk_notification        — every 10 minutes',
    'stepup_token_prune       — daily 03:00',
  ],
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {
  logger.info('Scheduler: shutting down', { signal, instanceId: INSTANCE_ID });
  try {
    await pool.end();
    logger.info('Scheduler: DB pool closed');
  } catch (err) {
    logger.error('Scheduler: error closing DB pool', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Scheduler: uncaught exception (process continues)', {
    error: err.message,
    stack: err.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Scheduler: unhandled rejection (process continues)', {
    reason: String(reason),
  });
});
