/**
 * Audit Service — Billing Module
 * Financial transaction logging + CA audit trail retrieval
 *
 * Write path: all INSERT operations are delegated to auditLogger.service.js.
 *   auditLogger is the single database writer for audit_logs.
 *   No direct INSERT INTO audit_logs exists in this file.
 *
 * Read path: direct pool queries are retained here (SELECT only).
 *
 * Fail-open: write functions are fire-and-forget.
 *   auditLogger.logEvent() never throws — no additional catch blocks needed.
 */

const pool        = require("../../config/db");
const auditLogger = require("../audit/auditLogger.service");

// ── Write functions ────────────────────────────────────────────────────────────

/**
 * Log an invoice state change.
 *
 * @param {string} organizationId
 * @param {string} invoiceId
 * @param {string} action           CREATE | UPDATE | SEND | VERIFY | CANCEL | REFUND
 * @param {Object} user             { id, orgRole }
 * @param {Object} previousState    Previous invoice state (null for CREATE)
 * @param {Object} newState         New invoice state
 * @param {string} reason
 * @param {Object} context          { ipAddress, userAgent, requestId }
 */
function logInvoiceChange(
  organizationId,
  invoiceId,
  action,
  user,
  previousState,
  newState,
  reason  = null,
  context = {}
) {
  auditLogger.logEvent({
    organizationId,
    entityType: "INVOICE",
    entityId:   invoiceId,
    action,
    actor:      { type: "USER", userId: user.id },
    reason,
    meta: {
      userRole:   user.orgRole || null,
      requestId:  context.requestId  || null,
      ipAddress:  context.ipAddress  || null,
      userAgent:  context.userAgent  || null,
    },
    oldState: previousState || null,
    newState: newState       || null,
  });
}

/**
 * Log a payment verification or rejection.
 *
 * @param {string} organizationId
 * @param {string} paymentId
 * @param {string} action           VERIFY | REJECT
 * @param {Object} user             { id, orgRole }
 * @param {Object} paymentData      { before, after }
 * @param {string} verificationResult  VERIFIED | REJECTED | PENDING
 * @param {string} notes
 * @param {Object} context          { ipAddress, userAgent, requestId }
 */
function logPaymentAction(
  organizationId,
  paymentId,
  action,
  user,
  paymentData,
  verificationResult,
  notes   = null,
  context = {}
) {
  const previousState = {
    ...(paymentData.before || {}),
    status: "PENDING_VERIFICATION",
  };

  const newState = {
    ...(paymentData.after || {}),
    status:             verificationResult,
    verification_notes: notes,
  };

  auditLogger.logEvent({
    organizationId,
    entityType: "PAYMENT",
    entityId:   paymentId,
    action,
    actor:      { type: "USER", userId: user.id },
    reason:     notes,
    meta: {
      userRole:  user.orgRole || null,
      requestId: context.requestId || null,
      ipAddress: context.ipAddress || null,
    },
    oldState:   previousState,
    newState,
  });
}

/**
 * Log an adjustment (refund, write-off, correction).
 *
 * @param {string} organizationId
 * @param {string} adjustmentId
 * @param {string} adjustmentType   REFUND | WRITE_OFF | CORRECTION
 * @param {Object} user             { id, orgRole }
 * @param {string} invoiceId
 * @param {number} amount
 * @param {string} reason
 * @param {Object} context          { ipAddress, requestId }
 */
function logAdjustment(
  organizationId,
  adjustmentId,
  adjustmentType,
  user,
  invoiceId,
  amount,
  reason,
  context = {}
) {
  auditLogger.logEvent({
    organizationId,
    entityType: "ADJUSTMENT",
    entityId:   adjustmentId,
    action:     adjustmentType,
    actor:      { type: "USER", userId: user.id },
    reason,
    meta: {
      adjustmentType,
      invoiceId,
      amount,
      requestId: context.requestId || null,
      ipAddress: context.ipAddress || null,
    },
  });
}

// ── Read functions (SELECT only — pool used directly) ─────────────────────────

/**
 * Retrieve complete audit trail for an entity.
 * Used by CAs to audit any transaction.
 *
 * @param {string} organizationId
 * @param {string} entityId
 * @returns {Promise<Array>}
 */
async function getAuditTrail(organizationId, entityId) {
  try {
    const result = await pool.query(
      `SELECT
        id,
        entity_type,
        entity_id,
        action,
        changed_by,
        user_role,
        changed_at,
        previous_state,
        new_state,
        reason,
        ip_address
      FROM audit_logs
      WHERE organization_id = $1 AND entity_id = $2
      ORDER BY changed_at ASC`,
      [organizationId, entityId]
    );

    return result.rows.map(row => ({
      auditId:        row.id,
      entityType:     row.entity_type,
      action:         row.action,
      changedBy:      row.changed_by,
      userRole:       row.user_role,
      changedAt:      row.changed_at,
      previousState:  row.previous_state,
      newState:       row.new_state,
      reason:         row.reason,
      ipAddress:      row.ip_address,
    }));
  } catch (error) {
    throw new Error("Failed to retrieve audit trail");
  }
}

/**
 * Get audit summary for an organisation (compliance reporting).
 *
 * @param {string} organizationId
 * @param {Object} filters  { startDate, endDate, entityType, action }
 * @returns {Promise<Array>}
 */
async function getAuditSummary(organizationId, filters = {}) {
  try {
    let query = `
      SELECT
        entity_type,
        action,
        COUNT(*) as count,
        MIN(changed_at) as earliest,
        MAX(changed_at) as latest
      FROM audit_logs
      WHERE organization_id = $1
    `;

    const params = [organizationId];
    let paramCount = 2;

    if (filters.startDate) {
      query += ` AND changed_at >= $${paramCount++}`;
      params.push(new Date(filters.startDate));
    }

    if (filters.endDate) {
      query += ` AND changed_at <= $${paramCount++}`;
      params.push(new Date(filters.endDate));
    }

    if (filters.entityType) {
      query += ` AND entity_type = $${paramCount++}`;
      params.push(filters.entityType);
    }

    if (filters.action) {
      query += ` AND action = $${paramCount++}`;
      params.push(filters.action);
    }

    query += ` GROUP BY entity_type, action ORDER BY entity_type, action`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

/**
 * Get all changes made by a specific user (access investigation).
 *
 * @param {string} organizationId
 * @param {string} userId
 * @param {Object} filters  { startDate, endDate, entityType }
 * @returns {Promise<Array>}
 */
async function getUserAuditTrail(organizationId, userId, filters = {}) {
  try {
    let query = `
      SELECT
        id,
        entity_type,
        entity_id,
        action,
        changed_at,
        reason
      FROM audit_logs
      WHERE organization_id = $1 AND changed_by = $2
    `;

    const params = [organizationId, userId];
    let paramCount = 3;

    if (filters.startDate) {
      query += ` AND changed_at >= $${paramCount++}`;
      params.push(new Date(filters.startDate));
    }

    if (filters.endDate) {
      query += ` AND changed_at <= $${paramCount++}`;
      params.push(new Date(filters.endDate));
    }

    if (filters.entityType) {
      query += ` AND entity_type = $${paramCount++}`;
      params.push(filters.entityType);
    }

    query += ` ORDER BY changed_at DESC LIMIT 500`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

/**
 * Export audit logs for compliance / regulatory reporting.
 *
 * @param {string} organizationId
 * @param {Object} filters  { startDate, endDate }
 * @returns {Promise<Array>}
 */
async function exportAuditLogs(organizationId, filters = {}) {
  try {
    let query = `
      SELECT
        id,
        entity_type,
        entity_id,
        action,
        changed_by,
        user_role,
        changed_at,
        reason,
        ip_address
      FROM audit_logs
      WHERE organization_id = $1
    `;

    const params = [organizationId];
    let paramCount = 2;

    if (filters.startDate) {
      query += ` AND changed_at >= $${paramCount++}`;
      params.push(new Date(filters.startDate));
    }

    if (filters.endDate) {
      query += ` AND changed_at <= $${paramCount++}`;
      params.push(new Date(filters.endDate));
    }

    query += ` ORDER BY changed_at DESC`;

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    throw error;
  }
}

/**
 * Verify audit trail integrity for an entity.
 *
 * @param {string} organizationId
 * @param {string} entityId
 * @returns {Promise<Object>}
 */
async function verifyAuditIntegrity(organizationId, entityId) {
  try {
    const trail = await getAuditTrail(organizationId, entityId);

    if (trail.length === 0) {
      return { status: "no_logs", message: "No audit logs found for entity" };
    }

    if (trail[0].action !== "CREATE") {
      return {
        status:  "warning",
        message: "First audit entry is not CREATE action",
        details: trail[0],
      };
    }

    for (let i = 1; i < trail.length; i++) {
      if (new Date(trail[i].changedAt) < new Date(trail[i - 1].changedAt)) {
        return {
          status:  "error",
          message: "Audit trail timestamp sequence invalid",
          details: { previousEntry: trail[i - 1], currentEntry: trail[i] },
        };
      }
    }

    return {
      status:      "ok",
      message:     "Audit trail integrity verified",
      entryCount:  trail.length,
      firstEntry:  trail[0].changedAt,
      lastEntry:   trail[trail.length - 1].changedAt,
    };
  } catch (error) {
    return { status: "error", message: `Integrity check failed: ${error.message}` };
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // Write (fire-and-forget, delegates to auditLogger)
  logInvoiceChange,
  logPaymentAction,
  logAdjustment,

  // Read (SELECT only)
  getAuditTrail,
  getAuditSummary,
  getUserAuditTrail,
  exportAuditLogs,
  verifyAuditIntegrity,
};
