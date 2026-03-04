'use strict';

const bcrypt       = require('bcryptjs');
const crypto       = require('crypto');
const jwt          = require('jsonwebtoken');
const pool         = require('../config/db');
const logger       = require('../utils/logger');
const sessionAudit = require('./sessionAudit.service');

// ─── Configuration ────────────────────────────────────────────────────────────

const MAX_SESSIONS      = 5;
const SESSION_TTL_DAYS  = 7;
const BCRYPT_ROUNDS     = 12;

// ─── Local error class ────────────────────────────────────────────────────────
// Defined locally to avoid a circular dependency with auth.service.js.
// Same interface as AuthError — controller catch blocks handle both identically.

class SessionError extends Error {
  constructor(code) {
    super(code);
    this.name  = 'SessionError';
    this.code  = code;
  }
}

// ─── JWT signing (mirrors auth.service.js config — DO NOT change payload shape) ──

function signToken(payload) {
  const JWT_SECRET = process.env.JWT_SECRET?.trim();
  if (!JWT_SECRET) throw new SessionError('SERVER_MISCONFIGURATION');

  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    issuer:    process.env.JWT_ISS    || 'SamaTechnologies',
    audience:  process.env.JWT_AUD   || 'SamaSuiteUsers',
    expiresIn: process.env.JWT_EXPIRES?.trim() || '15m',
  });
}

// ─── Refresh token format ─────────────────────────────────────────────────────
//
// Format:  <tokenId (UUID, 36 chars)>.<rawBytes (128 hex chars)>
//
// The tokenId is the sessions.token_id column value.
// It lets the refresh endpoint locate the exact session row in O(1)
// via an indexed lookup — a prerequisite for SELECT ... FOR UPDATE.
//
// The rawBytes are hashed with bcrypt and stored in refresh_token_hash.
// Verification: bcrypt.compare(rawBytes, session.refresh_token_hash).

const UUID_RE     = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RAW_HEX_LEN = 128; // 64 bytes as hex

/**
 * Generates a new opaque refresh token for a session.
 *
 * @param {string} tokenId  UUID that will be stored in sessions.token_id
 * @returns {{ rawToken: string, rawBytes: string }}
 *   rawToken  — the full token string sent to the client via HttpOnly cookie
 *   rawBytes  — the entropy portion, which is bcrypt-hashed and stored in DB
 */
function generateRefreshToken(tokenId) {
  const rawBytes = crypto.randomBytes(64).toString('hex');
  return { rawToken: `${tokenId}.${rawBytes}`, rawBytes };
}

/**
 * Parses a refresh token back into its components.
 * Returns null for any malformed token rather than throwing.
 *
 * @param {string} token
 * @returns {{ tokenId: string, rawBytes: string } | null}
 */
function parseRefreshToken(token) {
  if (!token || typeof token !== 'string') return null;

  // UUID is always 36 characters; dot separator at index 36.
  const dotIndex = token.indexOf('.');
  if (dotIndex !== 36) return null;

  const tokenId  = token.substring(0, 36);
  const rawBytes = token.substring(37);

  if (!UUID_RE.test(tokenId) || rawBytes.length !== RAW_HEX_LEN) return null;

  return { tokenId, rawBytes };
}

// ─── Device label ─────────────────────────────────────────────────────────────

/**
 * Best-effort device label derived from User-Agent.
 * Failures or unrecognised agents return 'Other' — never throws.
 *
 * @param {string|null|undefined} userAgent
 * @returns {string}
 */
function deriveDeviceLabel(userAgent) {
  try {
    if (!userAgent) return 'Unknown';
    if (/iPhone|iPad/i.test(userAgent))    return 'iOS';
    if (/Android/i.test(userAgent))        return 'Android';
    if (/Windows/i.test(userAgent))        return 'Windows';
    if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
    if (/Linux/i.test(userAgent))          return 'Linux';
    return 'Other';
  } catch (_) {
    return 'Other';
  }
}

// ─── Session cap enforcement ──────────────────────────────────────────────────

/**
 * Evicts the oldest sessions that exceed MAX_SESSIONS for this user + org.
 * Runs inside the CALLER's transaction via the supplied pg client.
 *
 * Evicted session IDs are marked revoked and a fire-and-forget audit row
 * is written per evicted session.
 *
 * @param {import('pg').PoolClient} client
 * @param {string} userId
 * @param {string} organizationId
 * @param {object} ctx
 * @param {string|null} [ctx.ipAddress]
 */
async function enforceSessionCap(client, userId, organizationId, ctx) {
  const { rows } = await client.query(
    `SELECT id
     FROM   sessions
     WHERE  user_id         = $1
       AND  organization_id = $2
       AND  revoked_at IS NULL
       AND  expires_at > now()
     ORDER BY created_at ASC`,   // oldest first → first candidates for eviction
    [userId, organizationId],
  );

  if (rows.length <= MAX_SESSIONS) return;

  const toEvict = rows.slice(0, rows.length - MAX_SESSIONS);
  const ids     = toEvict.map(r => r.id);

  await client.query(
    `UPDATE sessions
     SET    revoked_at = now()
     WHERE  id = ANY($1::uuid[])`,
    [ids],
  );

  for (const _ of toEvict) {
    sessionAudit.logSessionEvent({
      organizationId,
      userId,
      ipAddress: ctx.ipAddress || null,
      reason:    'concurrent_session_evicted',
    });
  }
}

/**
 * Best-effort session cap enforcement called after a login session is created.
 * Uses its own pooled connection and transaction.
 * NEVER throws — login must succeed regardless.
 *
 * @param {string} userId
 * @param {string} organizationId
 * @param {object} ctx
 */
async function enforceSessionCapForLogin(userId, organizationId, ctx) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await enforceSessionCap(client, userId, organizationId, ctx);
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    // Non-fatal — log but never propagate; login must not fail.
    logger.error('[sessionSecurity] enforceSessionCapForLogin failed', {
      userId,
      error: err.message,
    });
  } finally {
    client.release();
  }
}

// ─── rotateSession ────────────────────────────────────────────────────────────

/**
 * Transactional refresh token rotation with strict reuse detection.
 *
 * Transaction boundary:
 *   BEGIN
 *     SELECT … FOR UPDATE          — row-level lock; prevents parallel rotation
 *     [if revoked]  UPDATE all sessions SET revoked_at (nuke all)   → COMMIT
 *     [if valid]    UPDATE old session SET revoked_at
 *                   INSERT new session
 *                   enforceSessionCap
 *                   SELECT membership role
 *   COMMIT
 *
 * FAIL-CLOSED contract:
 *   - Any unexpected error inside the try block triggers ROLLBACK before rethrow.
 *   - When reuse is detected, the global revocation is COMMITTED before the
 *     error is thrown so the attacker's access is destroyed even if the
 *     legitimate user's response is generic.
 *   - A token is NEVER issued outside a successful COMMIT.
 *
 * Concurrency safety:
 *   SELECT … FOR UPDATE on sessions.token_id (unique indexed) ensures that
 *   two parallel requests presenting the same token race to the same row lock.
 *   Only one wins; the other either sees the session already revoked (reuse
 *   path) or the lock times out.
 *
 * @param {string} rawToken  Full refresh token from HttpOnly cookie
 * @param {object} [ctx]
 * @param {string|null} [ctx.ipAddress]
 * @param {string|null} [ctx.userAgent]
 * @returns {Promise<{ success: true, token: string, refreshToken: string }>}
 */
async function rotateSession(rawToken, ctx = {}) {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) {
    throw new SessionError('INVALID_REFRESH_TOKEN');
  }

  const { tokenId, rawBytes } = parsed;
  const { ipAddress = null, userAgent = null } = ctx;

  const client = await pool.connect();
  let committed = false;

  try {
    await client.query('BEGIN');

    // ── Locate and lock the session row ────────────────────────────────────
    // Index on token_id makes this O(1). FOR UPDATE prevents concurrent
    // rotation of the same token across parallel requests or Node instances.
    const { rows } = await client.query(
      `SELECT * FROM sessions WHERE token_id = $1 FOR UPDATE`,
      [tokenId],
    );

    if (rows.length === 0) {
      // Token never existed or has been cleaned up by the hourly job.
      await client.query('ROLLBACK');
      committed = true; // Treat as committed — nothing to roll back.
      throw new SessionError('INVALID_REFRESH_TOKEN');
    }

    const session = rows[0];

    // ── Reuse detection ─────────────────────────────────────────────────────
    // A token that maps to a revoked session means it was already rotated.
    // Someone is replaying a previously-used token → treat as compromise.
    if (session.revoked_at !== null) {
      // Nuke all active sessions for this user + org — assume credential theft.
      await client.query(
        `UPDATE sessions
         SET    revoked_at = now()
         WHERE  user_id         = $1
           AND  organization_id = $2
           AND  revoked_at IS NULL`,
        [session.user_id, session.organization_id],
      );

      await client.query('COMMIT');
      committed = true;

      // Fire-and-forget audit — after COMMIT so the revocation is persisted
      // even if the audit write fails.
      sessionAudit.logSessionEvent({
        organizationId: session.organization_id,
        userId:         session.user_id,
        ipAddress,
        reason:         'refresh_reuse_detected',
      });

      logger.warn('[sessionSecurity] refresh reuse detected — all sessions revoked', {
        userId:         session.user_id,
        organizationId: session.organization_id,
        ipAddress,
      });

      throw new SessionError('INVALID_REFRESH_TOKEN');
    }

    // ── Expiry double-check ─────────────────────────────────────────────────
    if (new Date(session.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      committed = true;
      throw new SessionError('INVALID_REFRESH_TOKEN');
    }

    // ── Hash verification ───────────────────────────────────────────────────
    const hashMatch = await bcrypt.compare(rawBytes, session.refresh_token_hash);
    if (!hashMatch) {
      // Hash mismatch despite correct token_id is anomalous — log it.
      logger.warn('[sessionSecurity] token_id matched but hash mismatch — possible tampering', {
        sessionId: session.id,
        ipAddress,
      });
      await client.query('ROLLBACK');
      committed = true;
      throw new SessionError('INVALID_REFRESH_TOKEN');
    }

    // ── Rotate: revoke old session ──────────────────────────────────────────
    await client.query(
      `UPDATE sessions SET revoked_at = now() WHERE id = $1`,
      [session.id],
    );

    // ── Create new session ──────────────────────────────────────────────────
    const newTokenId                  = crypto.randomUUID();
    const { rawToken: newRawToken,
            rawBytes: newRawBytes }   = generateRefreshToken(newTokenId);
    const newHash                     = await bcrypt.hash(newRawBytes, BCRYPT_ROUNDS);
    const deviceLabel                 = deriveDeviceLabel(userAgent || session.user_agent);

    await client.query(
      `INSERT INTO sessions
         (token_id, user_id, organization_id, refresh_token_hash,
          ip_address, user_agent, device_label, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '${SESSION_TTL_DAYS} days')`,
      [
        newTokenId,
        session.user_id,
        session.organization_id,
        newHash,
        ipAddress || session.ip_address,
        userAgent || session.user_agent,
        deviceLabel,
      ],
    );

    // ── Enforce session cap (within the same transaction) ──────────────────
    await enforceSessionCap(client, session.user_id, session.organization_id, ctx);

    // ── Fetch current role (membership may have changed since last login) ──
    const { rows: roleRows } = await client.query(
      `SELECT r.key AS role_key
       FROM   memberships m
       JOIN   roles r ON r.id = m.role_id
       WHERE  m.user_id         = $1
         AND  m.organization_id = $2::uuid
         AND  m.status          = 'active'
       LIMIT  1`,
      [session.user_id, session.organization_id],
    );

    if (!roleRows.length) {
      await client.query('ROLLBACK');
      committed = true;
      throw new SessionError('INVALID_ORGANIZATION_ACCESS');
    }

    // ── Sign new access token ───────────────────────────────────────────────
    const accessToken = signToken({
      sub:            session.user_id,
      organizationId: session.organization_id,
      role:           roleRows[0].role_key,
    });

    await client.query('COMMIT');
    committed = true;

    return {
      success:      true,
      token:        accessToken,
      refreshToken: newRawToken,
    };

  } catch (err) {
    if (!committed) {
      try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    }
    throw err;
  } finally {
    client.release();
  }
}

// ─── Admin: revoke all sessions for a user ────────────────────────────────────

/**
 * Revokes all active sessions for a user within an organization.
 * Intended for administrative actions (e.g. forced sign-out after role change).
 * Writes a single audit row regardless of how many sessions are revoked.
 *
 * @param {string} organizationId
 * @param {string} userId
 * @returns {Promise<number>}  Number of sessions revoked
 */
async function revokeUserSessions(organizationId, userId) {
  const { rowCount } = await pool.query(
    `UPDATE sessions
     SET    revoked_at = now()
     WHERE  user_id         = $1
       AND  organization_id = $2
       AND  revoked_at IS NULL`,
    [userId, organizationId],
  );

  if (rowCount > 0) {
    sessionAudit.logSessionEvent({
      organizationId,
      userId,
      ipAddress: null,
      reason:    'admin_session_revocation',
    });
  }

  return rowCount;
}

module.exports = {
  generateRefreshToken,
  parseRefreshToken,
  deriveDeviceLabel,
  enforceSessionCapForLogin,
  rotateSession,
  revokeUserSessions,
};
