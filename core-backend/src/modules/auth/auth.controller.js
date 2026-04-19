"use strict";

const authService = require("./auth.service");

const isProd = process.env.NODE_ENV === "production";

const COOKIE_CONFIG = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  path: "/api/auth/refresh",
};

/* -------------------------------------------------------------------------- */
/* REGISTER                                                                   */
/* -------------------------------------------------------------------------- */

exports.register = async (req, res) => {
  try {

    const { organizationId } = req.params || {};

    const result = await authService.register(
      organizationId,
      req.body
    );

    return res.status(201).json(result);

  } catch (error) {

    console.error("REGISTER ERROR:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message || "Registration failed"
    });

  }
};

/* -------------------------------------------------------------------------- */
/* LOGIN                                                                      */
/* -------------------------------------------------------------------------- */

exports.login = async (req, res) => {
  try {

    const { organizationId } = req.params || {};

    const { email, password } = req.body;

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

      return res.json(responseBody);
    }

    return res.json(result);

  } catch (error) {

    console.error("LOGIN ERROR:", error.message);

    return res.status(401).json({
      success: false,
      message: "INVALID_CREDENTIALS"
    });

  }
};

/* -------------------------------------------------------------------------- */
/* REFRESH TOKEN                                                              */
/* -------------------------------------------------------------------------- */

exports.refresh = async (req, res) => {
  try {

    const refreshToken = req.cookies?.refreshToken;

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
      message: "Authentication failed"
    });

  }
};

/* -------------------------------------------------------------------------- */
/* LOGOUT                                                                     */
/* -------------------------------------------------------------------------- */

exports.logout = async (req, res) => {
  try {

    const refreshToken = req.cookies?.refreshToken;

    await authService.logoutSession(refreshToken);

    res.clearCookie("refreshToken", { path: "/api/auth/refresh" });

    return res.json({ success: true });

  } catch (error) {

    console.error("LOGOUT ERROR:", error.message);

    return res.status(500).json({
      success: false,
      message: error.message
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
      message: error.message
    });

  }
};