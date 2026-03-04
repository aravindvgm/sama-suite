'use strict';

/**
 * riskCase.service.js
 *
 * Phase-8.7 — Security Operations Triage Layer.
 *
 * Manages the lifecycle of risk_cases records that group behavioral risk
 * signals for human operator review.
 *
 * Worker-facing function:
 *   syncRiskCases()
 *     Three-step bulk operation (all steps isolated by try/catch):
 *       1. INSERT … ON CONFLICT upsert OPEN cases for HIGH/CRITICAL users.
 *       2. UPDATE OPEN cases whose users' risk has dropped below HIGH.
 *       3. Bulk-link unlinked behavioral_risk_events → risk_case_id.
 *
 * REST-facing functions:
 *   listCases / getCaseById / acknowledgeCase / closeCase / triageEvent
 *
 * Invariants:
 *   - Every query is scoped to organization_id (no cross-tenant reads).
 *   - Service throws Error objects with .status (4xx) for application errors.
 *     Controllers check err.status to produce correct HTTP responses.
 *   - error.message is always a SCREAMING_SNAKE_CASE code string.
 *   - syncRiskCases() never throws — caller wraps in try/catch but this is
 *     defensive; all internal steps are isolated.
 *   - No changes to JWT, sessions, or Phase-8.5/8.6 scoring logic.
 */

const pool   = require('../config/db');
const logger = require('../utils/logger');

const WORKER_NAME = 'riskCase';

// Risk levels that trigger automatic case creation.
const TRIGGER_LEVELS = ['HIGH', 'CRITICAL'];

// Allowed triage verdict values.
const VALID_TRIAGE_STATUSES = new Set(['BENIGN', 'SUSPICIOUS']);

// ── Application error factory ─────────────────────────────────────────────────

function _appError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ── Private: existence check ──────────────────────────────────────────────────

/**
 * Fetch the id + status of a risk case scoped to the org.
 * Returns null when the case does not exist or belongs to a different org.
 * Used as a prerequisite check before state transitions.
 *
 * @param {string} organizationId
 * @param {string} caseId
 * @returns {Promise<{ id: string, status: string } | null>}
 */
async function _getCaseStub(organizationId, caseId) {
  const { rows } = await pool.query(
    `SELECT id, status FROM risk_cases WHERE id = $1 AND organization_id = $2`,
    [caseId, organizationId]
  );
  return rows[0] || null;
}

// ── Worker: sync cycle ────────────────────────────────────────────────────────

/**
 * syncRiskCases()
 *
 * One full risk-case synchronisation cycle.  Three isolated steps:
 *
 *   Step 1 — Upsert OPEN cases for HIGH/CRITICAL users.
 *     Uses a partial unique index (idx_rc_org_user_open WHERE status = 'OPEN')
 *     so a new OPEN case is created only when no OPEN case exists.
 *     The RETURNING (xmax = 0) trick distinguishes INSERTs from UPDATEs.
 *     peak_risk_score is monotonically increasing via GREATEST().
 *
 *   Step 2 — Refresh OPEN cases for users whose risk has dropped.
 *     Two sub-queries: one for users with a user_risk_state row at a lower
 *     level; one for users whose user_risk_state row has been pruned entirely
 *     (fully decayed, score = 0, NORMAL).  Cases remain OPEN — human must close.
 *
 *   Step 3 — Bulk-link unlinked behavioral_risk_events.
 *     UPDATE … FROM risk_cases WHERE risk_case_id IS NULL AND expires_at > NOW().
 *     Bounded by event expiry (24h) and the dedup window (15 min), so the
 *     maximum unlinked rows per user is bounded and the UPDATE is not unbounded.
 *
 * Never throws.
 *
 * @returns {Promise<{ casesCreated: number, casesUpdated: number, eventsLinked: number, errors: number, durationMs: number }>}
 */
async function syncRiskCases() {
  const startedAt    = Date.now();
  let casesCreated   = 0;
  let casesUpdated   = 0;
  let eventsLinked   = 0;
  let errors         = 0;

  // ── Step 1: Upsert OPEN cases for HIGH/CRITICAL users ────────────────────────
  // Single bulk INSERT … SELECT … ON CONFLICT — one round-trip for all users.
  // The partial unique index on (organization_id, user_id) WHERE status = 'OPEN'
  // is required for the ON CONFLICT inference to work.

  try {
    const { rows } = await pool.query(`
      INSERT INTO risk_cases
        (organization_id, user_id, risk_score, risk_level, signals,
         peak_risk_score,  peak_risk_level)
      SELECT urs.organization_id,
             urs.user_id,
             urs.risk_score,
             urs.risk_level,
             COALESCE(urs.signals_summary, '{}'),
             urs.risk_score,
             urs.risk_level
        FROM user_risk_state urs
       WHERE urs.risk_level IN ('HIGH', 'CRITICAL')
      ON CONFLICT (organization_id, user_id) WHERE status = 'OPEN'
      DO UPDATE SET
        risk_score      = EXCLUDED.risk_score,
        risk_level      = EXCLUDED.risk_level,
        signals         = EXCLUDED.signals,
        peak_risk_score = GREATEST(risk_cases.peak_risk_score, EXCLUDED.risk_score),
        peak_risk_level = CASE
          WHEN EXCLUDED.risk_score > risk_cases.peak_risk_score
          THEN EXCLUDED.risk_level
          ELSE risk_cases.peak_risk_level
        END,
        updated_at      = NOW()
      RETURNING (xmax = 0) AS is_new
    `);

    for (const row of rows) {
      if (row.is_new) casesCreated++;
      else            casesUpdated++;
    }
  } catch (err) {
    errors++;
    logger.warn(`${WORKER_NAME}: step 1 (upsert) failed`, { error: err.message });
  }

  // ── Step 2a: Refresh OPEN cases for users whose risk dropped (row exists) ────
  // Updates risk_score and risk_level to reflect current posture.
  // Cases remain OPEN — only a human operator can close them.

  try {
    await pool.query(`
      UPDATE risk_cases rc
         SET risk_score = urs.risk_score,
             risk_level = urs.risk_level,
             signals    = COALESCE(urs.signals_summary, '{}'),
             updated_at = NOW()
        FROM user_risk_state urs
       WHERE urs.organization_id = rc.organization_id
         AND urs.user_id         = rc.user_id
         AND rc.status           = 'OPEN'
         AND urs.risk_level NOT IN ('HIGH', 'CRITICAL')
    `);
  } catch (err) {
    errors++;
    logger.warn(`${WORKER_NAME}: step 2a (refresh dropped-risk) failed`, { error: err.message });
  }

  // ── Step 2b: Refresh OPEN cases for fully-decayed users (no state row) ───────
  // user_risk_state rows are pruned by runPruning() when score = 0 and stale.
  // We must handle this separately since there is no urs row to JOIN against.

  try {
    await pool.query(`
      UPDATE risk_cases rc
         SET risk_score = 0,
             risk_level = 'NORMAL',
             signals    = '{}',
             updated_at = NOW()
       WHERE rc.status = 'OPEN'
         AND NOT EXISTS (
           SELECT 1 FROM user_risk_state urs
            WHERE urs.organization_id = rc.organization_id
              AND urs.user_id         = rc.user_id
         )
    `);
  } catch (err) {
    errors++;
    logger.warn(`${WORKER_NAME}: step 2b (refresh fully-decayed) failed`, { error: err.message });
  }

  // ── Step 3: Bulk-link unlinked events to their OPEN cases ────────────────────
  // UPDATE … FROM avoids a per-user loop.  Bounded by:
  //   - expires_at > NOW()  (events decay after 24h)
  //   - risk_case_id IS NULL  (only unlinked events)
  // Events linked to a previous CLOSED case retain their risk_case_id; this
  // step only touches genuinely unlinked events.

  try {
    const { rowCount } = await pool.query(`
      UPDATE behavioral_risk_events bre
         SET risk_case_id = rc.id
        FROM risk_cases rc
       WHERE rc.organization_id = bre.organization_id
         AND rc.user_id         = bre.user_id
         AND rc.status          = 'OPEN'
         AND bre.expires_at     > NOW()
         AND bre.risk_case_id   IS NULL
    `);
    eventsLinked = rowCount || 0;
  } catch (err) {
    errors++;
    logger.warn(`${WORKER_NAME}: step 3 (event link) failed`, { error: err.message });
  }

  const durationMs = Date.now() - startedAt;
  return { casesCreated, casesUpdated, eventsLinked, errors, durationMs };
}

// ── REST: list cases ──────────────────────────────────────────────────────────

const VALID_STATUSES    = new Set(['OPEN', 'ACKNOWLEDGED', 'CLOSED']);
const VALID_RISK_LEVELS = new Set(['NORMAL', 'ELEVATED', 'HIGH', 'CRITICAL']);

/**
 * Return a paginated list of risk cases for an organization.
 * Includes per-case event counts grouped by triage_status.
 *
 * @param {string} organizationId
 * @param {{ status?: string, riskLevel?: string, limit?: number, offset?: number }} filters
 */
async function listCases(organizationId, { status, riskLevel, limit, offset } = {}) {
  if (status    && !VALID_STATUSES.has(status))       throw _appError('INVALID_STATUS',     400);
  if (riskLevel && !VALID_RISK_LEVELS.has(riskLevel)) throw _appError('INVALID_RISK_LEVEL', 400);

  const conditions = ['rc.organization_id = $1'];
  const params     = [organizationId];
  let   p          = 2;

  if (status)    { conditions.push(`rc.status     = $${p++}`); params.push(status);    }
  if (riskLevel) { conditions.push(`rc.risk_level = $${p++}`); params.push(riskLevel); }

  const safeLimit  = Math.min(Math.max(parseInt(limit,  10) || 20, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const { rows } = await pool.query(`
    SELECT rc.id,
           rc.organization_id,
           rc.user_id,
           rc.status,
           rc.risk_score,
           rc.risk_level,
           rc.peak_risk_score,
           rc.peak_risk_level,
           rc.signals,
           rc.acknowledged_by,
           rc.acknowledged_at,
           rc.closed_by,
           rc.closed_at,
           rc.close_reason,
           rc.opened_at,
           rc.updated_at,
           COUNT(bre.id) FILTER (WHERE bre.triage_status = 'UNREVIEWED')  AS unreviewed_events,
           COUNT(bre.id) FILTER (WHERE bre.triage_status = 'SUSPICIOUS')  AS suspicious_events,
           COUNT(bre.id) FILTER (WHERE bre.triage_status = 'BENIGN')      AS benign_events,
           COUNT(*) OVER ()                                                AS total_count
      FROM risk_cases rc
      LEFT JOIN behavioral_risk_events bre
             ON bre.risk_case_id     = rc.id
            AND bre.organization_id  = rc.organization_id
     WHERE ${conditions.join(' AND ')}
     GROUP BY rc.id
     ORDER BY rc.opened_at DESC
     LIMIT  $${p++}
     OFFSET $${p}
  `, [...params, safeLimit, safeOffset]);

  const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
  return {
    data:   rows.map(r => { const { total_count: _, ...rest } = r; return rest; }),
    total,
    limit:  safeLimit,
    offset: safeOffset,
  };
}

// ── REST: single case ─────────────────────────────────────────────────────────

/**
 * Return a single risk case with all linked behavioral_risk_events.
 *
 * @param {string} organizationId
 * @param {string} caseId
 * @returns {Promise<object|null>}
 */
async function getCaseById(organizationId, caseId) {
  const { rows: caseRows } = await pool.query(
    `SELECT * FROM risk_cases WHERE id = $1 AND organization_id = $2`,
    [caseId, organizationId]
  );

  if (caseRows.length === 0) return null;

  const { rows: eventRows } = await pool.query(
    `SELECT id,
            signal_type,
            severity,
            score_delta,
            context,
            detected_at,
            expires_at,
            triage_status,
            triaged_by,
            triage_note,
            triaged_at
       FROM behavioral_risk_events
      WHERE risk_case_id     = $1
        AND organization_id  = $2
      ORDER BY detected_at DESC`,
    [caseId, organizationId]
  );

  return { ...caseRows[0], events: eventRows };
}

// ── REST: acknowledge ─────────────────────────────────────────────────────────

/**
 * Transition a case from OPEN → ACKNOWLEDGED.
 *
 * @param {string} organizationId
 * @param {string} caseId
 * @param {string} operatorUserId
 * @throws 404 CASE_NOT_FOUND | 409 CASE_INVALID_STATUS_TRANSITION
 */
async function acknowledgeCase(organizationId, caseId, operatorUserId) {
  const stub = await _getCaseStub(organizationId, caseId);
  if (!stub) throw _appError('CASE_NOT_FOUND', 404);

  // Attempt the transition; if another operator raced us the UPDATE returns 0 rows.
  const { rows } = await pool.query(
    `UPDATE risk_cases
        SET status          = 'ACKNOWLEDGED',
            acknowledged_by = $3,
            acknowledged_at = NOW(),
            updated_at      = NOW()
      WHERE id              = $1
        AND organization_id = $2
        AND status          = 'OPEN'
      RETURNING id, status, acknowledged_at`,
    [caseId, organizationId, operatorUserId]
  );

  if (rows.length === 0) throw _appError('CASE_INVALID_STATUS_TRANSITION', 409);
  return rows[0];
}

// ── REST: close ───────────────────────────────────────────────────────────────

/**
 * Transition a case from OPEN or ACKNOWLEDGED → CLOSED.
 * closeReason is required and enforced to be at least 10 characters.
 *
 * @param {string} organizationId
 * @param {string} caseId
 * @param {string} operatorUserId
 * @param {string} closeReason
 * @throws 400 CLOSE_REASON_REQUIRED | 404 CASE_NOT_FOUND | 409 CASE_INVALID_STATUS_TRANSITION
 */
async function closeCase(organizationId, caseId, operatorUserId, closeReason) {
  if (!closeReason || typeof closeReason !== 'string' || closeReason.trim().length < 10) {
    throw _appError('CLOSE_REASON_REQUIRED', 400);
  }

  const stub = await _getCaseStub(organizationId, caseId);
  if (!stub) throw _appError('CASE_NOT_FOUND', 404);

  const { rows } = await pool.query(
    `UPDATE risk_cases
        SET status       = 'CLOSED',
            closed_by    = $3,
            closed_at    = NOW(),
            close_reason = $4,
            updated_at   = NOW()
      WHERE id              = $1
        AND organization_id = $2
        AND status         IN ('OPEN', 'ACKNOWLEDGED')
      RETURNING id, status, closed_at`,
    [caseId, organizationId, operatorUserId, closeReason.trim()]
  );

  if (rows.length === 0) throw _appError('CASE_INVALID_STATUS_TRANSITION', 409);
  return rows[0];
}

// ── REST: triage event ────────────────────────────────────────────────────────

/**
 * Set the operator triage verdict on a single behavioral_risk_event.
 *
 * @param {string} organizationId
 * @param {string} eventId
 * @param {'BENIGN'|'SUSPICIOUS'} triageStatus
 * @param {string|null} triageNote
 * @param {string} operatorUserId
 * @throws 400 INVALID_TRIAGE_STATUS | 404 EVENT_NOT_FOUND
 */
async function triageEvent(organizationId, eventId, triageStatus, triageNote, operatorUserId) {
  if (!VALID_TRIAGE_STATUSES.has(triageStatus)) {
    throw _appError('INVALID_TRIAGE_STATUS', 400);
  }

  const note = (typeof triageNote === 'string' && triageNote.trim().length > 0)
    ? triageNote.trim()
    : null;

  const { rows } = await pool.query(
    `UPDATE behavioral_risk_events
        SET triage_status = $3,
            triage_note   = $4,
            triaged_by    = $5,
            triaged_at    = NOW()
      WHERE id              = $1
        AND organization_id = $2
      RETURNING id, triage_status, triaged_at`,
    [eventId, organizationId, triageStatus, note, operatorUserId]
  );

  if (rows.length === 0) throw _appError('EVENT_NOT_FOUND', 404);
  return rows[0];
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  syncRiskCases,
  listCases,
  getCaseById,
  acknowledgeCase,
  closeCase,
  triageEvent,
};
