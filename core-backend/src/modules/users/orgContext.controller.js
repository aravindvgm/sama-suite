"use strict";

const pool = require("../../config/db");
const sessionService = require("../session/session.service");

exports.setActiveOrganization = async (req, res) => {
  const userId = req.user?.userId;
  const { organizationId } = req.body || {};

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "UNAUTHORIZED"
    });
  }

  if (!organizationId) {
    return res.status(400).json({
      success: false,
      message: "ORGANIZATION_ID_REQUIRED"
    });
  }

  const membership = await pool.query(
    `SELECT role
     FROM memberships
     WHERE user_id = $1
       AND organization_id = $2
     LIMIT 1`,
    [userId, organizationId]
  );

  if (membership.rows.length === 0) {
    return res.status(403).json({
      success: false,
      message: "FORBIDDEN"
    });
  }

  await pool.query(
    `UPDATE users
     SET active_organization_id = $1
     WHERE id = $2`,
    [organizationId, userId]
  );

  return res.json({
    success: true
  });
};

exports.getMyOrganizations = async (req, res) => {
  const userId = req.user?.userId;

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "UNAUTHORIZED"
    });
  }

  const orgs = await sessionService.getUserOrganizations(userId);

  return res.status(200).json({
    success: true,
    data: orgs
  });
};

