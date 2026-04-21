"use strict";

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authRepository = require("./auth.repository");

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function signToken({ userId, organizationId }) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    const err = new Error("JWT_SECRET_NOT_CONFIGURED");
    err.code = "SERVER_MISCONFIGURED";
    throw err;
  }

  return jwt.sign(
    { user_id: userId, organization_id: organizationId },
    secret,
    {
      algorithm: "HS256",
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );
}

async function register(payload) {
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "");
  const fullName = String(payload?.full_name || "").trim();
  const organizationName = String(payload?.organizationName || "").trim();

  if (!email || !password || !fullName || !organizationName) {
    const err = new Error("INVALID_REGISTRATION_DATA");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  if (!isValidEmail(email)) {
    const err = new Error("INVALID_EMAIL");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  if (password.length < 8) {
    const err = new Error("PASSWORD_TOO_SHORT");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  let created;

  try {
    created = await authRepository.createOrganizationAndUser({
      organizationName,
      email,
      passwordHash,
      fullName,
    });
  } catch (e) {
    console.error("REGISTER ERROR:", e.message);

    if (e?.code === "23505") {
      const err = new Error("EMAIL_ALREADY_EXISTS");
      err.code = "EMAIL_ALREADY_EXISTS";
      throw err;
    }

    throw e;
  }

  const token = signToken({
    userId: created.user.id,
    organizationId: created.organization.id,
  });

  return {
    token,
    user: created.user,
  };
}

async function login(payload) {
  const email = String(payload?.email || "").trim().toLowerCase();
  const password = String(payload?.password || "");

  if (!email || !password) {
    const err = new Error("INVALID_LOGIN_DATA");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  if (!isValidEmail(email)) {
    const err = new Error("INVALID_EMAIL");
    err.code = "VALIDATION_ERROR";
    throw err;
  }

  const row = await authRepository.findUserByEmailForLogin(email);

  if (!row) {
    const err = new Error("USER_NOT_FOUND");
    err.code = "USER_NOT_FOUND";
    throw err;
  }

  if (!row.password) {
    const err = new Error("INVALID_PASSWORD");
    err.code = "INVALID_PASSWORD";
    throw err;
  }

  const match = await bcrypt.compare(password, row.password);

  if (!match) {
    const err = new Error("INVALID_PASSWORD");
    err.code = "INVALID_PASSWORD";
    throw err;
  }

  const token = signToken({
    userId: row.id,
    organizationId: row.organization_id,
  });

  return {
    token,
    user: {
      id: row.id,
      email: row.email,
      full_name: row.full_name,
      organization_id: row.organization_id,
      created_at: row.created_at,
    },
  };
}

module.exports = { register, login };