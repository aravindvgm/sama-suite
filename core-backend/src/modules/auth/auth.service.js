"use strict";

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");
const sessionSecurity = require("../../services/sessionSecurity.service");

/* -------------------------------------------------------------------------- */
/* Error Classes */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Helpers */
/* -------------------------------------------------------------------------- */

function maskEmail(raw) {
  const [local, domain] = (raw || "").split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

async function recordLoginAudit({
  organizationId,
  userId,
  email,
  success,
  failureCode,
  ipAddress = null,
  userAgent = null,
  requestId = null
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
      )
      VALUES (
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
        userId || null,
        success ? "USER" : "SYSTEM",
        userId || null,
        failureCode || null,
        ipAddress,
        userAgent,
        requestId,
        JSON.stringify({
          email: maskEmail(email),
          failureCode: failureCode || null
        })
      ]
    );
  } catch (err) {
    console.error("[auth] audit log failure:", err.message);
  }
}

function signAuthToken(payload, secret) {
  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    issuer: process.env.JWT_ISS || "SamaTechnologies",
    audience: process.env.JWT_AUD || "SamaSuiteUsers",
    expiresIn: process.env.JWT_EXPIRES || "15m"
  });
}

/* -------------------------------------------------------------------------- */
/* Register */
/* -------------------------------------------------------------------------- */

async function register(organizationId, body) {
  const { email, password, full_name } = body;

  if (!email || !password) {
    throw new ValidationError("INVALID_DATA");
  }

  const normalizedEmail = email.toLowerCase().trim();

  const org = await pool.query(
    `SELECT id FROM organizations WHERE id=$1::uuid`,
    [organizationId]
  );

  if (!org.rowCount) {
    throw new AuthError("INVALID_ORGANIZATION_ID");
  }

  const exists = await pool.query(
    `SELECT id FROM users WHERE email=$1`,
    [normalizedEmail]
  );

  if (exists.rowCount) {
    throw new AuthError("EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const { rows: [user] } = await pool.query(
    `INSERT INTO users
     (email,password_hash,full_name,organization_id,is_active)
     VALUES ($1,$2,$3,$4,true)
     RETURNING id,email,full_name`,
    [
      normalizedEmail,
      passwordHash,
      full_name || null,
      organizationId
    ]
  );

  const roleResult = await pool.query(
    `SELECT id FROM roles WHERE key='org_admin' LIMIT 1`
  );

  const roleId = roleResult.rows[0]?.id;

  if (!roleId) {
    throw new AuthError("ROLE_NOT_FOUND");
  }

  await pool.query(
    `INSERT INTO memberships
     (user_id,organization_id,role_id,status)
     VALUES ($1,$2,$3,'active')`,
    [user.id, organizationId, roleId]
  );

  return {
    success: true,
    message: "User registered successfully",
    user
  };
}

/* -------------------------------------------------------------------------- */
/* Login */
/* -------------------------------------------------------------------------- */

async function loginUser(email, password, _organizationId, ctx = {}) {

  if (!email || !password) {
    throw new ValidationError("INVALID_DATA");
  }

  email = email.toLowerCase().trim();

  if (!process.env.JWT_SECRET) {
    throw new AuthError("SERVER_MISCONFIGURATION");
  }

  const JWT_SECRET = process.env.JWT_SECRET.trim();

  const {
    ipAddress = null,
    userAgent = null,
    requestId = null
  } = ctx;

  const { rows, rowCount } = await pool.query(
    `SELECT id,email,full_name,password_hash,is_active
     FROM users
     WHERE email=$1
     LIMIT 1`,
    [email]
  );

  if (!rowCount) {

    await recordLoginAudit({
      organizationId: null,
      userId: null,
      email,
      success: false,
      failureCode: "INVALID_CREDENTIALS",
      ipAddress,
      userAgent,
      requestId
    });

    throw new AuthError("INVALID_CREDENTIALS");

  }

  const user = rows[0];

  if (!user.password_hash) {
    throw new AuthError("INVALID_CREDENTIALS");
  }

  if (!user.is_active) {

    await recordLoginAudit({
      organizationId: null,
      userId: user.id,
      email,
      success: false,
      failureCode: "ACCOUNT_INACTIVE",
      ipAddress,
      userAgent,
      requestId
    });

    throw new AuthError("ACCOUNT_INACTIVE");

  }

  const match = await bcrypt.compare(password, user.password_hash);

  if (!match) {

    await recordLoginAudit({
      organizationId: null,
      userId: user.id,
      email,
      success: false,
      failureCode: "INVALID_CREDENTIALS",
      ipAddress,
      userAgent,
      requestId
    });

    throw new AuthError("INVALID_CREDENTIALS");

  }

  const { rows: memberships } = await pool.query(
    `SELECT m.organization_id, r.key AS role_key
     FROM memberships m
     JOIN roles r ON r.id=m.role_id
     WHERE m.user_id=$1
     AND m.status='active'`,
    [user.id]
  );

  if (!memberships.length) {
    throw new AuthError("ACCOUNT_NO_ORG_ACCESS");
  }

  const { organization_id, role_key } = memberships[0];

  const token = signAuthToken(
    {
      sub: user.id,
      organizationId: organization_id,
      role: role_key
    },
    JWT_SECRET
  );

  return {
    success: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      organizationId: organization_id,
      role: role_key
    }
  };

}

/* -------------------------------------------------------------------------- */

module.exports = {
  register,
  loginUser,
  AuthError,
  ValidationError
};