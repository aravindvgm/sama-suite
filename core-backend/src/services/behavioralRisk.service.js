'use strict';

/**
 * behavioralRisk.service.js
 *
 * Phase-8.5 — Behavioral Risk & Data Access Observability.
 *
 * Evaluates 5 deterministic behavioral signals against audit_logs to score each
 * active user's risk posture. Results are persisted in:
 *   behavioral_risk_events  — append-only event log (24-hour decay window)
 *   user_risk_state         — current risk snapshot (upserted each cycle)
 *
 * ┌─────┬──────────────────────────────┬──────────────┬───────────┬──────────────────────────────┐
 * │  #  │ Signal                       │ Source table │ Window    │ Default threshold            │
 * ├─────┼──────────────────────────────┼──────────────┼───────────┼──────────────────────────────┤
 * │  1  │ ENUMERATION                  │ audit_logs   │ 10 min    │ > 20 student list/search     │
 * │  2  │ EXPORT_SPIKE                 │ audit_logs   │ 30 min    │ > 5 export/download actions  │
 * │  3  │ SENSITIVE_CONCENTRATION      │ audit_logs   │ 60 min    │ > 60 % of requests sensitive │
 * │  4  │ OFF_HOURS                    │ audit_logs   │ 15 min    │ activity during 22:00–06:00  │
 * │  5  │ ROLE_DEVIATION               │ audit_logs   │ 15 min    │ entity outside role profile  │
 * └─────┴──────────────────────────────┴──────────────┴───────────┴──────────────────────────────┘
 *
 * Risk scoring (deterministic — no ML):
 *   score = SUM(score_delta) from non-expired behavioral_risk_events
 *   ENUMERATION:             +30 (HIGH)
 *   EXPORT_SPIKE:            +25 (HIGH)
 *   SENSITIVE_CONCENTRATION: +20 (MEDIUM)
 *   OFF_HOURS:               +10 (LOW)
 *   ROLE_DEVIATION:          +35 (HIGH)
 *
 * Risk levels:
 *   NORMAL:   0–29   ELEVATED: 30–59   HIGH: 60–89   CRITICAL: 90+
 *
 * Deduplication:
 *   A new behavioral_risk_events row is inserted only when no row for the same
 *   (organization_id, user_id, signal_type) exists within the last 15 minutes.
 *   This matches the worker run interval so each signal fires at most once per cycle.
 *
 * Per-school thresholds:
 *   school_risk_config overrides apply where a row exists. All detectors fall
 *   back to coded defaults for organisations without a config row.
 *
 * Fail-open:
 *   Each signal detector is called inside an allSettled wrapper. A failing
 *   detector does not abort the cycle. runBehavioralRisk() never throws.
 */

require('dotenv').config();

const pool   = require('../config/db');
const logger = require('../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

const WORKER_NAME   = 'behavioralRisk';

/** Deduplication window in minutes — should match the worker's run interval. */
const DEDUP_MINUTES = 15;

/** How long an event contributes to the user's risk score before decaying. */
const DECAY_HOURS   = 24;

/** Timezone used to evaluate off-hours (matches CRON_TIMEZONE). */
const TZ = process.env.CRON_TIMEZONE || 'Asia/Kolkata';

/** Score delta and severity for each signal type. */
const SIGNAL_CONFIG = {
  ENUMERATION:             { delta: 30, severity: 'HIGH'   },
  EXPORT_SPIKE:            { delta: 25, severity: 'HIGH'   },
  SENSITIVE_CONCENTRATION: { delta: 20, severity: 'MEDIUM' },
  OFF_HOURS:               { delta: 10, severity: 'LOW'    },
  ROLE_DEVIATION:          { delta: 35, severity: 'HIGH'   },
};

/** Ordered thresholds — first match wins. */
const RISK_THRESHOLDS = [
  { min: 90, level: 'CRITICAL' },
  { min: 60, level: 'HIGH'     },
  { min: 30, level: 'ELEVATED' },
  { min:  0, level: 'NORMAL'   },
];

/**
 * Roles excluded from the ROLE_DEVIATION check.
 * These roles have broad access by design; flagging them creates noise.
 */
const UNRESTRICTED_ROLES = new Set(['org_admin', 'super_admin', 'principal']);

/**
 * Per-role expected entity access patterns.
 * An entity_type accessed by a user that is NOT in their role's set triggers
 * ROLE_DEVIATION. Unknown role keys are conservatively skipped.
 */
const ROLE_ENTITY_MAP = {
  teacher:    new Set(['STUDENT', 'EXAM_RESULT', 'ATTENDANCE', 'NOTIFICATION', 'REPORT']),
  accountant: new Set(['PAYMENT', 'INVOICE', 'FINANCE', 'STUDENT', 'REPORT']),
  parent:     new Set(['STUDENT', 'PAYMENT', 'INVOICE', 'NOTIFICATION']),
  librarian:  new Set(['STUDENT', 'NOTIFICATION']),
};

/** entity_type values considered sensitive for concentration analysis. */
const SENSITIVE_ENTITY_SQL = `('STUDENT', 'EXAM_RESULT', 'PAYMENT', 'INVOICE', 'FINANCE')`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Classify a numeric risk score into a risk level.
 * @param {number} score
 * @returns {'NORMAL'|'ELEVATED'|'HIGH'|'CRITICAL'}
 */
function _classifyRisk(score) {
  for (const { min, level } of RISK_THRESHOLDS) {
    if (score >= min) return level;
  }
  return 'NORMAL';
}

// ── Signal 1: Enumeration ─────────────────────────────────────────────────────

/**
 * Detects users who repeatedly query student list/search endpoints in a short
 * window — consistent with bulk data harvesting or automated enumeration.
 *
 * @returns {Promise<Array<{ userId: string, orgId: string, context: object }>>}
 */
async function _detectEnumeration() {
  const { rows } = await pool.query(`
    WITH counted AS (
      SELECT al.actor_user_id                                  AS user_id,
             al.organization_id                                AS org_id,
             COUNT(*)                                          AS cnt,
             COALESCE(MAX(src.enumeration_threshold), 20)      AS threshold
        FROM audit_logs al
        LEFT JOIN school_risk_config src
               ON src.organization_id = al.organization_id
       WHERE al.entity_type    IN ('STUDENT')
         AND al.action         IN ('LIST', 'SEARCH', 'INDEX')
         AND al.actor_type      = 'USER'
         AND al.actor_user_id  IS NOT NULL
         AND al.created_at      > NOW() - INTERVAL '10 minutes'
       GROUP BY al.actor_user_id, al.organization_id
    )
    SELECT user_id, org_id, cnt::int AS cnt, threshold::int AS threshold
      FROM counted
     WHERE cnt > threshold
  `);

  return rows.map(r => ({
    userId:  r.user_id,
    orgId:   r.org_id,
    context: { count: r.cnt, threshold: r.threshold, windowMin: 10 },
  }));
}

// ── Signal 2: Export Spike ────────────────────────────────────────────────────

/**
 * Detects users who perform an unusual number of export or bulk-download
 * actions within a 30-minute window.
 *
 * @returns {Promise<Array<{ userId: string, orgId: string, context: object }>>}
 */
async function _detectExportSpike() {
  const { rows } = await pool.query(`
    WITH counted AS (
      SELECT al.actor_user_id                            AS user_id,
             al.organization_id                          AS org_id,
             COUNT(*)                                    AS cnt,
             COALESCE(MAX(src.export_threshold), 5)      AS threshold
        FROM audit_logs al
        LEFT JOIN school_risk_config src
               ON src.organization_id = al.organization_id
       WHERE al.action        IN ('EXPORT', 'DOWNLOAD', 'BULK_EXPORT')
         AND al.actor_type     = 'USER'
         AND al.actor_user_id IS NOT NULL
         AND al.created_at     > NOW() - INTERVAL '30 minutes'
       GROUP BY al.actor_user_id, al.organization_id
    )
    SELECT user_id, org_id, cnt::int AS cnt, threshold::int AS threshold
      FROM counted
     WHERE cnt > threshold
  `);

  return rows.map(r => ({
    userId:  r.user_id,
    orgId:   r.org_id,
    context: { count: r.cnt, threshold: r.threshold, windowMin: 30 },
  }));
}

// ── Signal 3: Sensitive Concentration ────────────────────────────────────────

/**
 * Detects users whose last-hour activity is heavily concentrated on sensitive
 * entity types (students, exam results, payments, invoices, finance).
 * Only considers users with at least 10 requests to suppress noise.
 *
 * @returns {Promise<Array<{ userId: string, orgId: string, context: object }>>}
 */
async function _detectSensitiveConcentration() {
  const { rows } = await pool.query(`
    WITH activity AS (
      SELECT al.actor_user_id                                                         AS user_id,
             al.organization_id                                                       AS org_id,
             COUNT(*) FILTER (WHERE al.entity_type IN ${SENSITIVE_ENTITY_SQL})       AS sensitive_cnt,
             COUNT(*)                                                                 AS total_cnt,
             COALESCE(MAX(src.sensitive_pct_threshold), 60.0)                        AS pct_threshold
        FROM audit_logs al
        LEFT JOIN school_risk_config src
               ON src.organization_id = al.organization_id
       WHERE al.actor_type     = 'USER'
         AND al.actor_user_id IS NOT NULL
         AND al.created_at     > NOW() - INTERVAL '60 minutes'
       GROUP BY al.actor_user_id, al.organization_id
      HAVING COUNT(*) >= 10
    )
    SELECT user_id,
           org_id,
           ROUND(100.0 * sensitive_cnt / total_cnt, 2) AS sensitive_pct,
           pct_threshold,
           sensitive_cnt::int                          AS sensitive_cnt,
           total_cnt::int                              AS total_cnt
      FROM activity
     WHERE 100.0 * sensitive_cnt / total_cnt > pct_threshold
  `);

  return rows.map(r => ({
    userId:  r.user_id,
    orgId:   r.org_id,
    context: {
      sensitivePct:   parseFloat(r.sensitive_pct),
      threshold:      parseFloat(r.pct_threshold),
      sensitiveCount: r.sensitive_cnt,
      totalCount:     r.total_cnt,
      windowMin:      60,
    },
  }));
}

// ── Signal 4: Off-Hours Access ────────────────────────────────────────────────

/**
 * Detects users who are active during configured off-hours.
 * off_hours_start / off_hours_end from school_risk_config are interpreted as
 * local time in TZ (CRON_TIMEZONE). The CASE handles midnight-spanning windows
 * (start > end, e.g. 22:00–06:00 IST).
 *
 * @returns {Promise<Array<{ userId: string, orgId: string, context: object }>>}
 */
async function _detectOffHours() {
  const { rows } = await pool.query(`
    SELECT DISTINCT al.actor_user_id AS user_id,
                    al.organization_id AS org_id
      FROM audit_logs al
      LEFT JOIN school_risk_config src
             ON src.organization_id = al.organization_id
     WHERE al.actor_type     = 'USER'
       AND al.actor_user_id IS NOT NULL
       AND al.created_at     > NOW() - INTERVAL '${DEDUP_MINUTES} minutes'
       AND (
         CASE
           -- Midnight-spanning window (22:00 – 06:00): start > end
           WHEN COALESCE(src.off_hours_start, '22:00'::TIME) > COALESCE(src.off_hours_end, '06:00'::TIME)
           THEN (al.created_at AT TIME ZONE $1)::TIME >= COALESCE(src.off_hours_start, '22:00'::TIME)
                OR
                (al.created_at AT TIME ZONE $1)::TIME <  COALESCE(src.off_hours_end,   '06:00'::TIME)
           -- Same-day window (e.g. 00:00 – 05:00)
           ELSE (al.created_at AT TIME ZONE $1)::TIME >= COALESCE(src.off_hours_start, '22:00'::TIME)
                AND
                (al.created_at AT TIME ZONE $1)::TIME <  COALESCE(src.off_hours_end,   '06:00'::TIME)
         END
       )
  `, [TZ]);

  return rows.map(r => ({
    userId:  r.user_id,
    orgId:   r.org_id,
    context: { timezone: TZ, windowMin: DEDUP_MINUTES },
  }));
}

// ── Signal 5: Role Deviation ──────────────────────────────────────────────────

/**
 * Detects users who access entity types that are outside the expected profile
 * for their role. Unrestricted roles (org_admin, super_admin, principal) are
 * excluded. Unknown role keys in ROLE_ENTITY_MAP are conservatively skipped.
 *
 * @returns {Promise<Array<{ userId: string, orgId: string, context: object }>>}
 */
async function _detectRoleDeviation() {
  const excludedRoles = [...UNRESTRICTED_ROLES].map(r => `'${r}'`).join(', ');

  const { rows } = await pool.query(`
    SELECT al.actor_user_id                                                         AS user_id,
           al.organization_id                                                       AS org_id,
           r.key                                                                    AS role_key,
           array_agg(DISTINCT al.entity_type)
             FILTER (WHERE al.entity_type IS NOT NULL)                             AS accessed_entities
      FROM audit_logs al
      JOIN user_memberships um
        ON um.user_id         = al.actor_user_id
       AND um.organization_id = al.organization_id
       AND um.status          = 'active'
      JOIN roles r ON r.id = um.role_id
     WHERE al.actor_type     = 'USER'
       AND al.actor_user_id IS NOT NULL
       AND al.created_at     > NOW() - INTERVAL '${DEDUP_MINUTES} minutes'
       AND r.key NOT IN (${excludedRoles})
     GROUP BY al.actor_user_id, al.organization_id, r.key
  `);

  const hits = [];

  for (const row of rows) {
    const allowed = ROLE_ENTITY_MAP[row.role_key];
    if (!allowed) continue; // Unknown role — skip (conservative)

    const deviating = (row.accessed_entities || []).filter(e => !allowed.has(e));
    if (deviating.length === 0) continue;

    hits.push({
      userId:  row.user_id,
      orgId:   row.org_id,
      context: {
        roleKey:           row.role_key,
        deviatingEntities: deviating,
        windowMin:         DEDUP_MINUTES,
      },
    });
  }

  return hits;
}

// ── Event persistence ─────────────────────────────────────────────────────────

/**
 * Insert a behavioral_risk_events row only if no row for the same
 * (organization_id, user_id, signal_type) was inserted within the last
 * DEDUP_MINUTES minutes.
 *
 * @returns {Promise<boolean>} true if a new row was inserted
 */
async function _insertEventIfNew(orgId, userId, signalType, severity, scoreDelta, context) {
  const { rowCount } = await pool.query(
    `INSERT INTO behavioral_risk_events
       (organization_id, user_id, signal_type, severity, score_delta, context, expires_at)
     SELECT $1, $2, $3, $4, $5, $6::jsonb, NOW() + INTERVAL '${DECAY_HOURS} hours'
      WHERE NOT EXISTS (
        SELECT 1 FROM behavioral_risk_events
         WHERE organization_id = $1
           AND user_id         = $2
           AND signal_type     = $3
           AND detected_at     > NOW() - INTERVAL '${DEDUP_MINUTES} minutes'
      )`,
    [orgId, userId, signalType, severity, scoreDelta, context ? JSON.stringify(context) : null]
  );
  return rowCount > 0;
}

// ── Score computation & state upsert ─────────────────────────────────────────

/**
 * Sum score_delta from all non-expired behavioral_risk_events for a user,
 * classify the total, and upsert user_risk_state.
 *
 * Emits a logger.warn for HIGH and CRITICAL users so they appear in the
 * security observability log stream.
 *
 * @param {string} orgId
 * @param {string} userId
 */
async function _computeAndUpsertRisk(orgId, userId) {
  const { rows } = await pool.query(
    `SELECT signal_type,
            SUM(score_delta)::int AS total,
            COUNT(*)::int         AS event_count
       FROM behavioral_risk_events
      WHERE organization_id = $1
        AND user_id         = $2
        AND expires_at      > NOW()
      GROUP BY signal_type`,
    [orgId, userId]
  );

  let totalScore = 0;
  const summary  = {};

  for (const row of rows) {
    totalScore += row.total;
    summary[row.signal_type] = { score: row.total, events: row.event_count };
  }

  const riskLevel = _classifyRisk(totalScore);

  await pool.query(
    `INSERT INTO user_risk_state
       (organization_id, user_id, risk_score, risk_level, last_updated_at, signals_summary)
     VALUES ($1, $2, $3, $4, NOW(), $5::jsonb)
     ON CONFLICT (organization_id, user_id) DO UPDATE
       SET risk_score      = EXCLUDED.risk_score,
           risk_level      = EXCLUDED.risk_level,
           last_updated_at = EXCLUDED.last_updated_at,
           signals_summary = EXCLUDED.signals_summary`,
    [orgId, userId, totalScore, riskLevel, JSON.stringify(summary)]
  );

  if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
    logger.warn(`${WORKER_NAME}: elevated user risk detected`, {
      organizationId: orgId,
      userId,
      riskScore:      totalScore,
      riskLevel,
      signals:        Object.keys(summary),
    });
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Run one full behavioral risk evaluation cycle:
 *   1. Run all 5 signal detectors in parallel.
 *   2. Insert new risk events (dedup-guarded, 15-minute window).
 *   3. Recompute and upsert risk state for every affected (org, user) pair.
 *
 * Never throws — all errors are isolated and counted in the returned summary.
 *
 * @returns {Promise<{ usersProcessed: number, eventsInserted: number, errors: number, durationMs: number }>}
 */
async function runBehavioralRisk() {
  const startedAt = Date.now();
  let eventsInserted = 0;
  let usersProcessed = 0;
  let errors         = 0;

  // ── 1. Run detectors in parallel ────────────────────────────────────────────

  const [enumResult, exportResult, sensitiveResult, offHoursResult, roleResult] =
    await Promise.allSettled([
      _detectEnumeration(),
      _detectExportSpike(),
      _detectSensitiveConcentration(),
      _detectOffHours(),
      _detectRoleDeviation(),
    ]);

  // ── 2. Collect triggered events ──────────────────────────────────────────────

  /** @type {Array<{ orgId, userId, signalType, severity, scoreDelta, context }>} */
  const triggered = [];

  const detectors = [
    { result: enumResult,      signalType: 'ENUMERATION'             },
    { result: exportResult,    signalType: 'EXPORT_SPIKE'            },
    { result: sensitiveResult, signalType: 'SENSITIVE_CONCENTRATION' },
    { result: offHoursResult,  signalType: 'OFF_HOURS'               },
    { result: roleResult,      signalType: 'ROLE_DEVIATION'          },
  ];

  for (const { result, signalType } of detectors) {
    if (result.status === 'rejected') {
      errors++;
      logger.warn(`${WORKER_NAME}: detector failed`, {
        signalType,
        error: result.reason?.message,
      });
      continue;
    }
    const { delta, severity } = SIGNAL_CONFIG[signalType];
    for (const hit of result.value) {
      triggered.push({ ...hit, signalType, severity, scoreDelta: delta });
    }
  }

  // ── 3. Insert events & collect affected (org, user) pairs ───────────────────

  /** @type {Map<string, { orgId: string, userId: string }>} */
  const affectedUsers = new Map();

  for (const ev of triggered) {
    try {
      const inserted = await _insertEventIfNew(
        ev.orgId, ev.userId, ev.signalType, ev.severity, ev.scoreDelta, ev.context
      );
      if (inserted) eventsInserted++;
    } catch (err) {
      errors++;
      logger.warn(`${WORKER_NAME}: event insert failed`, {
        signalType: ev.signalType,
        userId:     ev.userId,
        orgId:      ev.orgId,
        error:      err.message,
      });
    }
    const key = `${ev.orgId}:${ev.userId}`;
    if (!affectedUsers.has(key)) {
      affectedUsers.set(key, { orgId: ev.orgId, userId: ev.userId });
    }
  }

  // ── 4. Recompute & upsert risk state ────────────────────────────────────────

  for (const { orgId, userId } of affectedUsers.values()) {
    try {
      await _computeAndUpsertRisk(orgId, userId);
      usersProcessed++;
    } catch (err) {
      errors++;
      logger.warn(`${WORKER_NAME}: risk state update failed`, {
        userId,
        orgId,
        error: err.message,
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  return { usersProcessed, eventsInserted, errors, durationMs };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = { runBehavioralRisk };
