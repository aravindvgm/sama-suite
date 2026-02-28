'use strict';

const cron   = require('node-cron');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const pool   = require('../config/db');
const logger = require('../utils/logger');

const { getAdminOverview }           = require('../modules/admin/adminOverviewDashboard.service');
const { findCachedAudio,
        saveCachedAudio }            = require('../modules/ai/assistantAudioCache.service');
const { textToSpeech }               = require('../utils/tts.service');
const { sendWhatsAppAudio }          = require('../utils/whatsapp.service');
const { logSuccess, logFailure }     = require('./notificationLogs.service');
const auditService                   = require('../utils/auditService');

// ============================================================
// CONSTANTS
// ============================================================

const REMINDER_TYPE  = 'DAILY_BRIEFING';
const CRON_SCHEDULE  = '0 7 * * *';                        // daily 07:30 IST
const CRON_TIMEZONE  = process.env.CRON_TIMEZONE || 'Asia/Kolkata';
const CACHE_DIR      = path.resolve('storage/audio_cache');

// ============================================================
// FETCH ACTIVE ORGANISATIONS  (same pattern as studentAutoAction)
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
// IDEMPOTENCY  — one briefing per org per calendar day
// ============================================================

async function hasAlreadyBriefedToday(organizationId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM   notification_logs
     WHERE  organization_id = $1
       AND  reminder_type   = $2
       AND  DATE(created_at) = CURRENT_DATE
     LIMIT  1`,
    [organizationId, REMINDER_TYPE]
  );
  return rows.length > 0;
}

// ============================================================
// FETCH PRINCIPAL CONTACT
// ============================================================

async function fetchPrincipalContact(organizationId) {
  const { rows } = await pool.query(
    `SELECT mobile_number
     FROM   users
     WHERE  organization_id = $1
       AND  role            = 'PRINCIPAL'
       AND  deleted_at IS NULL
     LIMIT  1`,
    [organizationId]
  );
  return rows[0] ? rows[0].mobile_number : null;
}

// ============================================================
// BRIEFING TEXT BUILDER
//
// Short, voice-friendly sentences — no punctuation symbols that
// TTS might mispronounce.  Indian number formatting for currency.
// ============================================================

function fmt(amount) {
  return Number(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function buildBriefingMessage(orgName, overview) {
  const {
    todayAttendancePercentage,
    todayCollection,
    pendingFeesCount,
    birthdayStudentsToday,
    pendingReconcilePayments,
  } = overview;

  const attendance = todayAttendancePercentage !== null ? `${todayAttendancePercentage}` : '0';
  const collection = fmt(todayCollection);
  const fees       = pendingFeesCount;
  const birthdays  = birthdayStudentsToday;
  const reconcile  = pendingReconcilePayments;

  return [
    'Good morning.',
    `Today\'s attendance is ${attendance} percent.`,
    `Today\'s collection is rupees ${collection}.`,
    `${fees} student${fees !== 1 ? 's have' : ' has'} overdue fees.`,
    `${birthdays} birthday${birthdays !== 1 ? 's' : ''} today.`,
    `${reconcile} payment${reconcile !== 1 ? 's' : ''} pending reconciliation.`,
    'Have a productive day.',
  ].join(' ');
}

// ============================================================
// SAVE AUDIO STREAM TO FILE  (promise-wrapped)
// ============================================================

async function saveStreamToFile(audioStream, filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(filePath);
    audioStream.on('error', reject);
    fileStream.on('error', reject);
    fileStream.on('finish', resolve);
    audioStream.pipe(fileStream);
  });
}

// ============================================================
// PROCESS ONE ORGANISATION
// ============================================================

async function processOrg(org) {
  // ── Idempotency — skip if already sent today ──────────────
  if (await hasAlreadyBriefedToday(org.id)) {
    logger.info('DailyBriefing: already briefed today — skipping', { organizationId: org.id });
    return;
  }

  // ── Dashboard data (reuse existing service) ───────────────
  const overview = await getAdminOverview({ organizationId: org.id });

  // ── Principal contact ─────────────────────────────────────
  const mobile = await fetchPrincipalContact(org.id);
  if (!mobile) {
    logger.warn('DailyBriefing: no principal contact — skipping', { organizationId: org.id });
    return;
  }

  // ── Briefing text ─────────────────────────────────────────
  const briefingText = buildBriefingMessage(org.name, overview);

  // ── Audio cache key ───────────────────────────────────────
  const today    = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const cacheKey = crypto
    .createHash('sha256')
    .update(`daily-briefing-${org.id}-${today}`)
    .digest('hex');

  // ── Resolve audio path (cache hit or generate) ────────────
  let audioPath;

  const cached = await findCachedAudio({ organizationId: org.id, cacheKey });

  if (cached && fs.existsSync(path.resolve(cached.audio_path))) {
    audioPath = path.resolve(cached.audio_path);
    logger.info('DailyBriefing: audio cache hit', { organizationId: org.id, audioPath });
  } else {
    logger.info('DailyBriefing: generating TTS audio', { organizationId: org.id });

    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const savePath    = path.join(CACHE_DIR, `daily-briefing-${cacheKey}.mp3`);
    const audioStream = await textToSpeech(briefingText);

    await saveStreamToFile(audioStream, savePath);

    await saveCachedAudio({
      organizationId: org.id,
      cacheKey,
      question:  `Daily briefing for ${org.name} on ${today}`,
      answer:    briefingText,
      audioPath: savePath,
    });

    audioPath = savePath;
    logger.info('DailyBriefing: audio generated and cached', { organizationId: org.id, audioPath });
  }

  // ── Send WhatsApp audio ───────────────────────────────────
  try {
    const result = await sendWhatsAppAudio(mobile, audioPath, 'Daily School Briefing');

    await logSuccess({
      organizationId: org.id,
      studentId:      null,
      feeId:          null,
      contactNumber:  mobile,
      channel:        'WHATSAPP',
      message:        briefingText,
      reminderType:   REMINDER_TYPE,
      messageId:      result.messageId,
      attempts:       1,
    });

    logger.info('DailyBriefing: briefing sent', {
      organizationId: org.id,
      mobile,
      messageId: result.messageId,
    });

    // Non-blocking SYSTEM audit entry per org per day
    auditService.logAction({
      organizationId: org.id,
      actorType:      'SYSTEM',
      action:         'DAILY_BRIEFING_SENT',
      entityType:     'ORGANIZATION',
      entityId:       org.id,
      meta: {
        messageId: result.messageId,
        mobile,            // will be PII-masked by auditService
        channel:   'WHATSAPP',
      },
    }).catch(() => {});

  } catch (err) {
    await logFailure({
      organizationId: org.id,
      studentId:      null,
      feeId:          null,
      contactNumber:  mobile,
      channel:        'WHATSAPP',
      message:        briefingText,
      reminderType:   REMINDER_TYPE,
      attempts:       1,
      errorMessage:   err.message,
    });

    logger.error('DailyBriefing: send failed', {
      organizationId: org.id,
      mobile,
      error: err.message,
    });
  }
}

// ============================================================
// MAIN ENTRY POINT
//
// Processes all active organisations sequentially.
// Per-org try/catch prevents one org failure from stopping others.
// ============================================================

async function runPrincipalDailyBriefing() {
  logger.info('DailyBriefing: worker started');

  let orgs;
  try {
    orgs = await fetchActiveOrganizations();
  } catch (err) {
    logger.error('DailyBriefing: failed to fetch organizations', { error: err.message });
    return;
  }

  logger.info('DailyBriefing: processing organizations', { count: orgs.length });

  for (const org of orgs) {
    try {
      await processOrg(org);
    } catch (err) {
      // Isolate per-org failures — other orgs must still run
      logger.error('DailyBriefing: unhandled error for org', {
        organizationId: org.id,
        error: err.message,
      });
    }
  }

  logger.info('DailyBriefing: run complete', { count: orgs.length });
}

// ============================================================
// CRON SCHEDULE  —  daily 07:30 IST
// Only active when this file is the entry point (not when
// imported by jobScheduler.worker.js which manages its own cron).
// ============================================================

if (require.main === module) {
  cron.schedule(CRON_SCHEDULE, async () => {
    try {
      await runPrincipalDailyBriefing();
    } catch (err) {
      logger.error('DailyBriefing: cron job failed', { error: err.message });
    }
  }, { timezone: CRON_TIMEZONE });

  logger.info('DailyBriefing: worker scheduled', {
    schedule: CRON_SCHEDULE,
    timezone: CRON_TIMEZONE,
  });

  process.on('uncaughtException',  (err) => logger.error('DailyBriefing: uncaughtException',  { error: err.message }));
  process.on('unhandledRejection', (err) => logger.error('DailyBriefing: unhandledRejection', { error: String(err) }));
}

module.exports = { runPrincipalDailyBriefing };
