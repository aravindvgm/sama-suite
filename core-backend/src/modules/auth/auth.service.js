"use strict";

const bcrypt          = require("bcryptjs");
const crypto          = require("crypto");
const jwt             = require("jsonwebtoken");
const pool            = require("../../config/db");
const sessionSecurity = require("../../services/sessionSecurity.service");

// ─── Structured Error Classes ─────────────────────────────────────────────────

class AuthError extends Error {
  constructor(code) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
}

class ValidationError extends AuthError {
  constructor(code) {
    super(code);
    this.name = "ValidationError";
  }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/** Masks an email address for safe audit logging. user@example.com → u***@example.com */
function maskEmail(raw) {
  const [local, domain] = (raw || "").split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

/**
 * Appends a login attempt record to audit_logs.
 * Fire-and-forget — audit failure must never block the auth flow.
 *
 * @param {object} params
 * @param {string|null} params.organizationId  - null when org context is unavailable
 * @param {string|null} params.userId          - null for "user not found" failures
 * @param {string|null} params.email           - raw email (will be masked before storage)
 * @param {boolean}     params.success
 * @param {string|null} params.failureCode
 * @param {string|null} [params.ipAddress]
 * @param {string|null} [params.userAgent]
 * @param {string|null} [params.requestId]
 */
async function recordLoginAudit({
  organizationId,
  userId,
  email,
  success,
  failureCode,
  ipAddress = null,
  userAgent = null,
  requestId = null,
}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (
         organization_id,
         entity_type,
         entity_id,
         action,
         changed_by,
         actor_type,
         actor_user_id,
         reason,
         ip_address,
         user_agent,
         request_id,
         meta
       ) VALUES (
         $1::uuid,
         'AUTH',
         COALESCE($2::uuid, gen_random_uuid()),
         $3,
         $4::uuid,
         $5,
         $6::uuid,
         $7,
         $8,
         $9,
         $10,
         $11::jsonb
       )`,
      [
        organizationId,
        userId || null,
        success ? "LOGIN_SUCCESS" : "LOGIN_FAILURE",
        userId || null,                           // changed_by (nullable per migration 020)
        success ? "USER" : "SYSTEM",              // USER requires actor_user_id per chk_actor_user_required
        userId || null,                           // actor_user_id
        failureCode || null,                      // reason
        ipAddress,
        userAgent,
        requestId,
        JSON.stringify({ email: maskEmail(email), failureCode: failureCode || null }),
      ]
    );
  } catch (auditErr) {
    // Non-fatal: surface internally but never propagate to the caller
    console.error("[auth] audit_log write failed:", auditErr.message);
  }
}

/**
 * Scaffold — future separation of identity verification from tenant login audit events.
 * Not called anywhere. Do not add queries or logic here until the identity event model is defined.
 */
async function recordIdentityVerifiedAudit() {
  return;
}
void recordIdentityVerifiedAudit; // private scaffold — intentionally unexported and uncalled

/** Signs a JWT with the shared application configuration. Payload must be pre-built. */
function signAuthToken(payload, secret) {
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISS || "SamaTechnologies",
    audience: process.env.JWT_AUD || "SamaSuiteUsers",
    expiresIn: process.env.JWT_EXPIRES ? process.env.JWT_EXPIRES.trim() : "15m",
  });
}

/**
 * Scans all candidate sessions and returns the first one whose stored hash matches
 * the provided raw token via bcrypt.compare.
 * Returns null if no match is found.
 *
 * NOTE: bcrypt hashes cannot be indexed; comparison is O(n) over active sessions.
 */
async function findSessionByToken(rawToken) {
  const { rows } = await pool.query(
    `SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > now()`
  );

  for (const session of rows) {
    const ok = await bcrypt.compare(rawToken, session.refresh_token_hash);
    if (ok) return session;
  }

  return null;
}

// ─── Register ─────────────────────────────────────────────────────────────────

async function register(organizationId, body) {
  const { email, password, full_name } = body;

  if (!email || !password) {
    throw new ValidationError("INVALID_DATA");
  }

  // Verify organization exists (multi-tenant enforcement)
  const org = await pool.query(
    `SELECT id FROM organizations WHERE id = $1::uuid`,
    [organizationId]
  );
  if (!org.rowCount) {
    throw new AuthError("INVALID_ORGANIZATION_ID");
  }

  // Guard against duplicate email
  const exists = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (exists.rowCount) {
    throw new AuthError("EMAIL_ALREADY_EXISTS");
  }

  // Hash password
  const hash = await bcrypt.hash(password, 12);

  // Insert user record (try/catch guards against race on the users_email_unique index)
  let user;
  try {
    const { rows: [inserted] } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, organization_id, is_active)
       VALUES ($1, $2, $3, $4::uuid, true)
       RETURNING id, email, full_name`,
      [email.toLowerCase().trim(), hash, full_name || null, organizationId]
    );
    user = inserted;
  } catch (err) {
    if (err && err.code === "23505") {
      throw new AuthError("EMAIL_ALREADY_EXISTS");
    }
    throw err;
  }

  // Resolve default role for new org members
  const roleResult = await pool.query(
    `SELECT id FROM roles WHERE key = 'org_admin' LIMIT 1`
  );
  const roleId = roleResult.rows[0]?.id;
  if (!roleId) {
    throw new AuthError("ROLE_NOT_FOUND");
  }

  // Create active membership
  await pool.query(
    `INSERT INTO memberships (user_id, organization_id, role_id, status)
     VALUES ($1, $2::uuid, $3, 'active')`,
    [user.id, organizationId, roleId]
  );

  return {
    success: true,
    message: "User registered successfully",
    user,
  };
}

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * Global identity login. Resolves organization access via memberships.
 *
 * @param {string} email
 * @param {string} password
 * @param {string} [organizationId]  - accepted for backward compatibility, ignored
 * @param {object} [ctx]             - optional request context for audit logging
 * @param {string} [ctx.ipAddress]
 * @param {string} [ctx.userAgent]
 * @param {string} [ctx.requestId]
 *
 * @returns Single-org login: { success, token, refreshToken, user: { id, email, full_name, organizationId, role } }
 * @returns Multi-org:        { success, requiresOrgSelection, organizations: [{ organizationId, role }] }
 */
async function loginUser(email, password, _organizationId, ctx = {}) {
  // _organizationId is retained in the signature for backward compatibility — intentionally unused
  email = email.toLowerCase().trim();

  if (!process.env.JWT_SECRET) {
    console.error("[auth] JWT_SECRET environment variable is not configured");
    throw new AuthError("SERVER_MISCONFIGURATION");
  }
  const JWT_SECRET = process.env.JWT_SECRET.trim();

  const { ipAddress = null, userAgent = null, requestId = null } = ctx;

  // Step 1 — find user by email (global identity, no org scope at this stage)
  const { rows: userRows, rowCount: userCount } = await pool.query(
    `SELECT id, email, full_name, password_hash, is_active
     FROM users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email]
  );

  if (!userCount) {
    await recordLoginAudit({ organizationId: null, userId: null, email, success: false, failureCode: "INVALID_CREDENTIALS", ipAddress, userAgent, requestId });
    throw new AuthError("INVALID_CREDENTIALS");
  }

  const user = userRows[0];

  // Step 2 — account status check before password work
  if (!user.is_active) {
    await recordLoginAudit({ organizationId: null, userId: user.id, email, success: false, failureCode: "ACCOUNT_INACTIVE", ipAddress, userAgent, requestId });
    throw new AuthError("ACCOUNT_INACTIVE");
  }

  // Step 3 — constant-time password comparison
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    await recordLoginAudit({ organizationId: null, userId: user.id, email, success: false, failureCode: "INVALID_CREDENTIALS", ipAddress, userAgent, requestId });
    throw new AuthError("INVALID_CREDENTIALS");
  }

  // Step 4 — fetch all active memberships for this user
  const { rows: memberships } = await pool.query(
    `SELECT m.organization_id, r.key AS role_key
     FROM memberships m
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1
       AND m.status = 'active'`,
    [user.id]
  );

  // Step 5 — no org access at all
  if (memberships.length === 0) {
    throw new AuthError("ACCOUNT_NO_ORG_ACCESS");
  }

  // Step 6 — single membership: issue JWT + create session
  if (memberships.length === 1) {
    const { organization_id, role_key } = memberships[0];

    const token = signAuthToken(
      { sub: user.id, organizationId: organization_id, role: role_key },
      JWT_SECRET
    );

    // Generate opaque refresh token (new format: tokenId.rawBytes for O(1) rotation lookup)
    const tokenId                               = crypto.randomUUID();
    const { rawToken: refreshToken, rawBytes }  = sessionSecurity.generateRefreshToken(tokenId);
    const refreshTokenHash                      = await bcrypt.hash(rawBytes, 12);
    const deviceLabel                           = sessionSecurity.deriveDeviceLabel(userAgent);

    await pool.query(
      `INSERT INTO sessions
         (token_id, user_id, organization_id, refresh_token_hash,
          ip_address, user_agent, device_label, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '7 days')`,
      [tokenId, user.id, organization_id, refreshTokenHash, ipAddress, userAgent, deviceLabel]
    );

    // Enforce concurrent session cap — best-effort, login must not fail if this errors.
    sessionSecurity.enforceSessionCapForLogin(user.id, organization_id, { ipAddress, userAgent });

    await recordLoginAudit({ organizationId: organization_id, userId: user.id, email, success: true, ipAddress, userAgent, requestId });

    return {
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        organizationId: organization_id,
        role: role_key,
      },
    };
  }

  // Step 7 — multiple memberships: return selection prompt (no JWT, no session, no LOGIN_SUCCESS audit)
  return {
    success: true,
    requiresOrgSelection: true,
    organizations: memberships.map(({ organization_id, role_key }) => ({
      organizationId: organization_id,
      role: role_key,
    })),
  };
}

// ─── Select Organization ──────────────────────────────────────────────────────

/**
 * Issues a scoped JWT after the user selects an organization.
 * Must be called from a route protected by JWT middleware (userId from token).
 *
 * @param {string} userId         - from authenticated JWT context
 * @param {string} organizationId - the org the user selected
 * @param {object} [ctx]          - optional request context for audit logging
 * @param {string} [ctx.ipAddress]
 * @param {string} [ctx.userAgent]
 * @param {string} [ctx.requestId]
 *
 * @returns { success, token, user: { id, organizationId, role } }
 */
async function selectOrganization(userId, organizationId, ctx = {}) {
  if (!process.env.JWT_SECRET) {
    console.error("[auth] JWT_SECRET environment variable is not configured");
    throw new AuthError("SERVER_MISCONFIGURATION");
  }
  const JWT_SECRET = process.env.JWT_SECRET.trim();

  const { ipAddress = null, userAgent = null, requestId = null } = ctx;

  // Verify the user holds an active membership for the requested org
  const { rows, rowCount } = await pool.query(
    `SELECT r.key AS role_key
     FROM memberships m
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1
       AND m.organization_id = $2::uuid
       AND m.status = 'active'`,
    [userId, organizationId]
  );

  if (!rowCount) {
    throw new AuthError("INVALID_ORGANIZATION_ACCESS");
  }

  const { role_key } = rows[0];

  const token = signAuthToken(
    { sub: userId, organizationId, role: role_key },
    JWT_SECRET
  );

  // email is not available in this context — maskEmail(null) safely returns "***"
  await recordLoginAudit({ organizationId, userId, email: null, success: true, ipAddress, userAgent, requestId });

  return {
    success: true,
    token,
    user: {
      id: userId,
      organizationId,
      role: role_key,
    },
  };
}

// ─── Refresh Session ──────────────────────────────────────────────────────────

/**
 * Validates an opaque refresh token, rotates it, and issues a new access JWT.
 *
 * Delegates entirely to sessionSecurity.rotateSession which enforces:
 * - Transactional rotation (BEGIN / COMMIT / ROLLBACK)
 * - Row-level locking via SELECT … FOR UPDATE on sessions.token_id
 * - Strict reuse detection (revoked token → nuke all sessions → deny)
 * - Concurrent session cap enforcement within the same transaction
 * - Fail-closed: no token issued unless the transaction commits successfully
 *
 * @param {string} refreshToken  - raw opaque token from httpOnly cookie
 * @param {object} [ctx]
 * @param {string|null} [ctx.ipAddress]
 * @param {string|null} [ctx.userAgent]
 * @returns {Promise<{ success: true, token: string, refreshToken: string }>}
 */
async function refreshSession(refreshToken, ctx = {}) {
  if (!refreshToken) {
    throw new AuthError("INVALID_REFRESH_TOKEN");
  }

  return sessionSecurity.rotateSession(refreshToken, ctx);
}

// ─── Logout Session ───────────────────────────────────────────────────────────

/**
 * Revokes the session associated with the given refresh token.
 * Idempotent — returns success even if no matching session is found.
 *
 * @param {string} refreshToken - raw opaque token from httpOnly cookie
 * @returns { success: true }
 */
async function logoutSession(refreshToken) {
  if (!refreshToken) {
    return { success: true };
  }

  const matched = await findSessionByToken(refreshToken);

  if (matched) {
    await pool.query(
      `UPDATE sessions SET revoked_at = now() WHERE id = $1`,
      [matched.id]
    );
  }

  return { success: true };
}

// ─── Logout All Sessions ──────────────────────────────────────────────────────

/**
 * Revokes all active sessions for a user (e.g. after password change or security event).
 * Idempotent — does not throw if no sessions exist.
 *
 * @param {string} userId
 * @returns { success: true }
 */
async function logoutAllSessions(userId) {
  await pool.query(
    `UPDATE sessions
     SET revoked_at = now()
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [userId]
  );

  return { success: true };
}

// ─── Session Cleanup ──────────────────────────────────────────────────────────

setInterval(async () => {
  try {
    await pool.query(
      `DELETE FROM sessions
       WHERE (expires_at < now())
          OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`
    );
  } catch (err) {
    console.error("[auth] session cleanup failed:", err.message);
  }
}, 60 * 60 * 1000); // run hourly

module.exports = {
  register,
  loginUser,
  selectOrganization,
  refreshSession,
  logoutSession,
  logoutAllSessions,
  AuthError,
  ValidationError,
};
