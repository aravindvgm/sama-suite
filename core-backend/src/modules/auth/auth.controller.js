"use strict";

const authService = require("./auth.service");

function sendResponse(res, status, success, data, message = null) {
  return res.status(status).json({
    success,
    message,
    data,
  });
}

exports.register = async (req, res) => {
  try {
    const result = await authService.register(req.body);

    return sendResponse(res, 201, true, result, "REGISTER_SUCCESS");
  } catch (err) {
    if (err?.code === "VALIDATION_ERROR") {
      return sendResponse(res, 400, false, null, err.message);
    }

    if (err?.code === "EMAIL_ALREADY_EXISTS") {
      return sendResponse(res, 409, false, null, err.message);
    }

    console.error("REGISTER CONTROLLER ERROR:", err);

    return sendResponse(res, 500, false, null, "REGISTRATION_FAILED");
  }
};

exports.login = async (req, res) => {
  try {
    const result = await authService.login(req.body);

    return sendResponse(res, 200, true, result, "LOGIN_SUCCESS");
  } catch (err) {
    if (err?.code === "VALIDATION_ERROR") {
      return sendResponse(res, 400, false, null, err.message);
    }

    if (err?.code === "USER_NOT_FOUND") {
      return sendResponse(res, 404, false, null, "USER_NOT_FOUND");
    }

    if (err?.code === "INVALID_PASSWORD") {
      return sendResponse(res, 401, false, null, "INVALID_PASSWORD");
    }

    if (err?.code === "SERVER_MISCONFIGURED") {
      return sendResponse(res, 500, false, null, "INTERNAL_SERVER_ERROR");
    }

    console.error("LOGIN CONTROLLER ERROR:", err);

    return sendResponse(res, 500, false, null, "INTERNAL_SERVER_ERROR");
  }
};