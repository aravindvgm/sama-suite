'use strict';

/**
 * auditLogger.service.js
 *
 * Centralised audit writer. All audit_logs inserts must go through logEvent()
 * so that governance rules are enforced consistently and bypasses are prevented.
 *
 * Governance rules (validated before every DB write):
 *   - actor is required and must have a valid .type
 *   - USER actors: actor.userId and organizationId are required
 *   - SYSTEM / AI actors: actor.userId must be absent / null
 *   - entityType and action are required strings
 *   - entityId may be null; if provided it must be a string (UUID format)
 *
 * Hash chain:
 *   INSERT + previous_hash SELECT + hash UPDATE run inside a single explicit
 *   transaction.  Before the SELECT a per-organisation advisory lock is
 *   acquired with pg_advisory_xact_lock(hashtext($orgKey)) so that concurrent
 *   writes for the same organisation are serialised at the chain-link step,
 *   preventing two rows from claiming the same previous_hash.
 *
 *   previous_hash  — record_hash of the most recent prior row for the same
 *                    organization_id (NULL for chain-head rows)
 *   record_hash    — SHA-256 hex digest of a fixed canonical field set that
 *                    includes previous_hash, forming a tamper-evident chain
 *
 * Failure contract:
 *   - Validation failure  → logger.warn + return (never throw)
 *   - Client acquire fail → logger.warn + counter++ + return (never throw)
 *   - Transaction error   → ROLLBACK + logger.warn + counter++ + return (never throw)
 *   - Hash UPDATE failure → ROLLBACK + logger.warn + counter++ + return (never throw)
 *     (entire transaction is rolled back so the row is not left without a hash)
 *
 * Column mapping (function param → DB column):
 *   actor.type   → actor_type
 *   actor.userId → actor_user_id  (USER only; null for SYSTEM/AI)
 *   actor.userId → changed_by     (USER only; null for SYSTEM/AI)
 *   oldState     → previous_state
 *   newState     → new_state
 */

const crypto = require('crypto');
const pool   = require('../../config/db');
const logger = require('../../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_ACTOR_TYPES = new Set(['USER', 'SYSTEM', 'AI']);

// Stable key used for advisory lock when organizationId is null (cross-org events)
const NULL_ORG_LOCK_KEY = '__NULL_ORG__';

// ── Internal counter ──────────────────────────────────────────────────────────

const _counters = { failedAuditInserts: 0 };

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns an array of validation error strings.
 * Empty array means the event is valid and safe to persist.
 *
 * @private
 */
function _validate({ organizationId, entityType, entityId, action, actor }) {
  const errors = [];

  // ── actor object ────────────────────────────────────────────────────────────
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    errors.push('actor is required and must be a plain object');
    return errors; // Cannot continue actor sub-checks without the object
  }

  // ── actor.type ──────────────────────────────────────────────────────────────
  if (!actor.type || !VALID_ACTOR_TYPES.has(actor.type)) {
    errors.push(
      `actor.type must be 'USER', 'SYSTEM', or 'AI' — received: ${JSON.stringify(actor.type)}`
    );
  }

  // ── USER-specific rules ─────────────────────────────────────────────────────
  if (actor.type === 'USER') {
    if (!actor.userId) {
      errors.push('actor.userId is required when actor.type is USER');
    }
    if (!organizationId) {
      errors.push('organizationId is required when actor.type is USER');
    }
  }

  // ── Non-USER: actor.userId must be absent / null ────────────────────────────
  if (actor.type !== 'USER' && actor.userId != null) {
    errors.push(
      `actor.userId must be null when actor.type is ${actor.type} — received a non-null value`
    );
  }

  // ── entityType ──────────────────────────────────────────────────────────────
  if (!entityType || typeof entityType !== 'string') {
    errors.push('entityType is required and must be a non-empty string');
  }

  // ── action ──────────────────────────────────────────────────────────────────
  if (!action || typeof action !== 'string') {
    errors.push('action is required and must be a non-empty string');
  }

  // ── entityId ────────────────────────────────────────────────────────────────
  if (entityId !== null && entityId !== undefined && typeof entityId !== 'string') {
    errors.push(
      `entityId must be a string (UUID) or null — received: ${typeof entityId}`
    );
  }

  return errors;
}

// ── Hash chain helpers ────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a canonical string built from the
 * supplied audit row fields.
 *
 * Canonical order (fixed — must never change without a migration note):
 *   id | organization_id | entity_type | entity_id | action |
 *   actor_type | actor_user_id | created_at | previous_hash
 *
 * Each field is coerced to a string; NULL values become the literal "NULL"
 * so the representation is unambiguous and collision-free.
 *
 * @private
 * @param {object} fields
 * @returns {string}  64-character lowercase hex digest
 */
function _computeRecordHash(fields) {
  const str = [
    fields.id,
    fields.organization_id,
    fields.entity_type,
    fields.entity_id,
    fields.action,
    fields.actor_type,
    fields.actor_user_id,
    fields.created_at,
    fields.previous_hash,
  ]
    .map(v => (v === null || v === undefined ? 'NULL' : String(v)))
    .join('|');

  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// ── logEvent ──────────────────────────────────────────────────────────────────

/**
 * Validate and persist one audit event inside an explicit transaction with a
 * per-organisation advisory lock to serialise concurrent hash-chain writes.
 *
 * Transaction sequence:
 *   BEGIN
 *   SELECT pg_advisory_xact_lock(hashtext($orgKey))  ← serialises chain links
 *   INSERT INTO audit_logs … RETURNING …
 *   SELECT record_hash FROM audit_logs WHERE id != $newId … ORDER BY … LIMIT 1
 *   UPDATE audit_logs SET previous_hash, record_hash WHERE id = $newId
 *   COMMIT
 *
 * Any failure at any step triggers ROLLBACK + logger.warn + counter++ + return.
 *
 * @param {object}       params
 * @param {string|null}  params.organizationId  Required for USER actors.
 * @param {string}       params.entityType      e.g. 'PAYMENT', 'STUDENT'
 * @param {string|null}  params.entityId        UUID string or null
 * @param {string}       params.action          e.g. 'CREATE', 'FEE_REMINDER_SENT'
 * @param {object}       params.actor
 * @param {string}       params.actor.type      'USER' | 'SYSTEM' | 'AI'
 * @param {string}       [params.actor.userId]  Required when actor.type = 'USER'
 * @param {string}       [params.reason]        Business reason for the change
 * @param {object}       [params.meta]          Lightweight change summary (field-level)
 * @param {object}       [params.oldState]      State before the action (CREATE → null)
 * @param {object}       [params.newState]      State after the action
 * @returns {Promise<void>}
 */
async function logEvent({
  organizationId = null,
  entityType,
  entityId       = null,
  action,
  actor,
  reason         = null,
  meta           = null,
  oldState       = null,
  newState       = null,
}) {
  // ── 1. Governance validation ─────────────────────────────────────────────────
  const errors = _validate({ organizationId, entityType, entityId, action, actor });

  if (errors.length > 0) {
    logger.warn('AuditLogger: governance validation failed — event not written', {
      errors,
      organizationId,
      entityType,
      entityId,
      action,
      actorType: actor?.type,
    });
    return; // Never throw
  }

  // ── 2. Resolve DB column values ──────────────────────────────────────────────
  const actorType   = actor.type;
  const actorUserId = actorType === 'USER' ? (actor.userId || null) : null;
  const changedBy   = actorUserId; // mirrors actor_user_id; NULL for SYSTEM/AI

  // ── 3. Serialise JSONB fields ────────────────────────────────────────────────
  const metaJson     = meta     != null ? JSON.stringify(meta)     : null;
  const oldStateJson = oldState != null ? JSON.stringify(oldState) : null;
  const newStateJson = newState != null ? JSON.stringify(newState) : null;

  // ── 4. Acquire dedicated client ──────────────────────────────────────────────
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    _counters.failedAuditInserts += 1;
    logger.warn('AuditLogger: failed to acquire DB client', {
      organizationId,
      entityType,
      action,
      failedAuditInserts: _counters.failedAuditInserts,
      error: err.message,
    });
    return; // Never throw
  }

  // ── 5. Transaction: advisory lock → INSERT → SELECT → UPDATE → COMMIT ────────
  try {
    await client.query('BEGIN');

    // 5a. Acquire per-organisation advisory lock for the duration of this
    //     transaction.  pg_advisory_xact_lock is automatically released on
    //     COMMIT or ROLLBACK.  hashtext() maps the string key to a 32-bit int
    //     understood by the advisory lock system.
    const lockKey = organizationId || NULL_ORG_LOCK_KEY;
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      ['audit_chain', lockKey]
    );

    // 5b. INSERT the audit row and retrieve canonical fields for hashing.
    const insertResult = await client.query(
      `INSERT INTO audit_logs
         (organization_id, entity_type, entity_id, action,
          actor_type,      actor_user_id, changed_by,
          reason,          meta,          previous_state, new_state,
          created_at)
       VALUES
         ($1,  $2,  $3,  $4,
          $5,  $6,  $7,
          $8,  $9,  $10, $11,
          NOW())
       RETURNING id, organization_id, entity_type, entity_id, action,
                 actor_type, actor_user_id, created_at`,
      [
        organizationId, // $1
        entityType,     // $2
        entityId,       // $3
        action,         // $4
        actorType,      // $5
        actorUserId,    // $6  actor_user_id
        changedBy,      // $7  changed_by
        reason,         // $8
        metaJson,       // $9
        oldStateJson,   // $10 previous_state
        newStateJson,   // $11 new_state
      ]
    );

    const row = insertResult.rows[0];

    // 5c. Fetch the previous row's record_hash for this organisation.
    //     Because the advisory lock is held, no other transaction can insert
    //     a competing row and claim the same previous_hash until we COMMIT.
    const prevResult = await client.query(
      `SELECT record_hash
         FROM audit_logs
        WHERE id != $1
          AND (
            ($2::uuid IS NOT NULL AND organization_id = $2::uuid)
            OR
            ($2::uuid IS NULL AND organization_id IS NULL)
          )
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [row.id, organizationId]
    );
    const previousHash =
      prevResult.rows.length > 0 ? (prevResult.rows[0].record_hash || null) : null;

    // 5d. Compute SHA-256 record_hash from canonical fields.
    const recordHash = _computeRecordHash({
      id:              row.id,
      organization_id: row.organization_id,
      entity_type:     row.entity_type,
      entity_id:       row.entity_id,
      action:          row.action,
      actor_type:      row.actor_type,
      actor_user_id:   row.actor_user_id,
      created_at:      row.created_at,
      previous_hash:   previousHash,
    });

    // 5e. Update the row with both hash values.
    await client.query(
      `UPDATE audit_logs
          SET previous_hash = $1,
              record_hash   = $2
        WHERE id = $3`,
      [previousHash, recordHash, row.id]
    );

    await client.query('COMMIT');

  } catch (err) {
    // Roll back the entire transaction so the row is never left without its
    // hash values (or partially written).
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logger.warn('AuditLogger: ROLLBACK failed', {
        organizationId,
        entityType,
        action,
        error: rbErr.message,
      });
    }

    _counters.failedAuditInserts += 1;
    logger.warn('AuditLogger: transaction failed — audit event not persisted', {
      organizationId,
      entityType,
      entityId,
      action,
      actorType,
      failedAuditInserts: _counters.failedAuditInserts,
      error: err.message,
    });
    // Never throw — audit failure must not interrupt the calling request.

  } finally {
    client.release();
  }
}

// ── Diagnostics ───────────────────────────────────────────────────────────────

/**
 * Returns the number of failed DB inserts since process start.
 * Expose via a health-check route or APM integration for alerting.
 *
 * @returns {number}
 */
function getFailedAuditInsertCount() {
  return _counters.failedAuditInserts;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  logEvent,
  getFailedAuditInsertCount,
};
