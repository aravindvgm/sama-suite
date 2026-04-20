"use strict";

const authService = require("./auth.service");
const pool = require("../../config/db");

const isProd = process.env.NODE_ENV === "production";

const COOKIE_CONFIG = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/api/auth/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

function sendSuccess(res, { message, data }, status = 200) {
  return res.status(status).json({
    success: true,
    ...(message ? { message } : {}),
    ...(data ? { data } : {})
  });
}

function sendError(res, { message }, status) {
  return res.status(status).json({
    success: false,
    message
  });
}

/* -------------------------------------------------------------------------- */
/* REGISTER                                                                   */
/* -------------------------------------------------------------------------- */

exports.register = async (req, res) => {
  try {
    const { organizationId } = req.params || {};
    const { email, password } = req.body;

    // ✅ validation
    if (!email || !password) {
      return sendError(res, { message: "EMAIL_AND_PASSWORD_REQUIRED" }, 400);
    }

    console.log("CONTROLLER REQ.BODY:", JSON.stringify(req.body));

    const result = await authService.register(
      organizationId,
      req.body
    );

    return sendSuccess(
      res,
      {
        message: result?.message || "REGISTER_SUCCESS",
        data: result?.user ? { user: result.user } : result
      },
      201
    );

  } catch (error) {
    console.error("REGISTER ERROR:", error.message);

    return sendError(res, { message: error.message || "REGISTRATION_FAILED" }, 400);
  }
};

/* -------------------------------------------------------------------------- */
/* LOGIN                                                                      */
/* -------------------------------------------------------------------------- */

exports.login = async (req, res) => {
  try {
    const { organizationId } = req.params || {};
    const { email, password } = req.body;

    const debugAuth = process.env.DEBUG_AUTH === "true";
    const maskEmail = (raw) => {
      const [local, domain] = String(raw || "").split("@");
      if (!local || !domain) return "***";
      return `${local[0]}***@${domain}`;
    };

    // ✅ validation
    if (!email || !password) {
      return sendError(res, { message: "EMAIL_AND_PASSWORD_REQUIRED" }, 400);
    }

    if (debugAuth) {
      console.log("[auth/login] email:", maskEmail(email));
    }

    // Debug-only lookup snapshot (never logs password/hash)
    if (debugAuth) {
      const normalizedEmail = String(email).toLowerCase().trim();
      const lookup = await pool.query(
        `SELECT id, email, is_active,
                (password_hash IS NOT NULL) AS has_password_hash
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [normalizedEmail]
      );

      const row = lookup.rows[0];
      console.log("[auth/login] user lookup:", {
        found: !!row,
        id: row?.id || null,
        email: row?.email ? maskEmail(row.email) : null,
        is_active: row?.is_active ?? null,
        has_password_hash: row?.has_password_hash ?? null
      });
    }

    const ctx = {
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null
    };

    const result = await authService.loginUser(
      email,
      password,
      organizationId,
      ctx
    );

    if (result.refreshToken) {
      res.cookie("refreshToken", result.refreshToken, COOKIE_CONFIG);

      const { refreshToken, ...responseBody } = result;
      return sendSuccess(res, {
        message: "LOGIN_SUCCESS",
        data: responseBody
      });
    }

    return sendSuccess(res, {
      message: "LOGIN_SUCCESS",
      data: result
    });

  } catch (error) {
    console.error("LOGIN ERROR:", error.message);

    return sendError(res, { message: "INVALID_CREDENTIALS" }, 401);
  }
};

/* -------------------------------------------------------------------------- */
/* REFRESH TOKEN                                                              */
/* -------------------------------------------------------------------------- */

exports.refresh = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    // ✅ validation
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "REFRESH_TOKEN_MISSING"
      });
    }

    const ctx = {
      ipAddress: req.ip || null,
      userAgent: req.headers["user-agent"] || null
    };

    const result = await authService.refreshSession(refreshToken, ctx);

    res.cookie("refreshToken", result.refreshToken, COOKIE_CONFIG);

    return res.json({
      success: true,
      token: result.token
    });

  } catch (error) {
    console.error("REFRESH ERROR:", error.message);

    return res.status(401).json({
      success: false,
      message: "AUTHENTICATION_FAILED"
    });
  }
};

/* -------------------------------------------------------------------------- */
/* LOGOUT                                                                     */
/* -------------------------------------------------------------------------- */

exports.logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      await authService.logoutSession(refreshToken);
    }

    res.clearCookie("refreshToken", { path: "/api/auth/refresh" });

    return res.json({ success: true });

  } catch (error) {
    console.error("LOGOUT ERROR:", error.message);

    return res.status(500).json({
      success: false,
      message: "LOGOUT_FAILED"
    });
  }
};

/* -------------------------------------------------------------------------- */
/* LOGOUT ALL                                                                 */
/* -------------------------------------------------------------------------- */

exports.logoutAll = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "UNAUTHORIZED"
      });
    }

    await authService.logoutAllSessions(userId);

    res.clearCookie("refreshToken", { path: "/api/auth/refresh" });

    return res.json({ success: true });

  } catch (error) {
    console.error("LOGOUT-ALL ERROR:", error.message);

    return res.status(500).json({
      success: false,
      message: "LOGOUT_ALL_FAILED"
    });
  }
};

/* -------------------------------------------------------------------------- */
/* CURRENT USER (REQUIRES AUTH)                                               */
/* -------------------------------------------------------------------------- */

exports.me = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      "SELECT id, email, created_at FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return sendError(res, { message: "USER_NOT_FOUND" }, 404);
    }

    return sendSuccess(res, {
      message: "USER_FETCHED",
      data: { user: result.rows[0] }
    });

  } catch (err) {
    return sendError(res, { message: "FAILED_TO_FETCH_USER" }, 500);
  }
};