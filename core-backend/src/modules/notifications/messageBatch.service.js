'use strict';

/**
 * messageBatch.service.js
 *
 * Outbound messaging safety guardrails.
 *
 * Responsibilities:
 *   1. Cost estimation:  recipientCount × WHATSAPP_COST_PER_MSG
 *   2. Threshold check:  recipientCount > MAX_RECIPIENTS || cost > MAX_COST_INR
 *   3. Batch record CRUD in outbound_message_batches (audit trail)
 *
 * All DB operations fail-open — a batch write failure must never
 * block a legitimate send.  DB errors are logged but not propagated.
 *
 * ENV vars (all optional, sane defaults apply):
 *   WHATSAPP_COST_PER_MSG  — cost per message in INR (default: 0.50)
 *   BATCH_MAX_RECIPIENTS   — max recipients before confirmation required (default: 500)
 *   BATCH_MAX_COST_INR     — max estimated cost in ₹ before confirmation (default: 2000)
 */

const pool   = require('../../config/db');
const logger = require('../../utils/logger');

// ============================================================
// THRESHOLDS  (loaded once at module initialisation)
// ============================================================

const COST_PER_MSG   = parseFloat(process.env.WHATSAPP_COST_PER_MSG || '0.50');
const MAX_RECIPIENTS = parseInt(process.env.BATCH_MAX_RECIPIENTS    || '500', 10);
const MAX_COST_INR   = parseFloat(process.env.BATCH_MAX_COST_INR    || '2000');

// ============================================================
// COST ESTIMATION
// ============================================================

function estimateCost(recipientCount) {
  return parseFloat((recipientCount * COST_PER_MSG).toFixed(2));
}

// ============================================================
// THRESHOLD CHECK
//
// Returns a plain object — never throws.
// ============================================================

/**
 * @param {number} recipientCount
 * @returns {{
 *   exceeded:        boolean,
 *   recipientCount:  number,
 *   estimatedCost:   number,
 *   maxRecipients:   number,
 *   maxCostInr:      number,
 *   reasons:         string[]
 * }}
 */
function checkThresholds(recipientCount) {
  const estimatedCost = estimateCost(recipientCount);
  const reasons       = [];

  if (recipientCount > MAX_RECIPIENTS) {
    reasons.push(`recipient_count ${recipientCount} exceeds limit ${MAX_RECIPIENTS}`);
  }
  if (estimatedCost > MAX_COST_INR) {
    reasons.push(`estimated_cost ₹${estimatedCost} exceeds limit ₹${MAX_COST_INR}`);
  }

  return {
    exceeded:       reasons.length > 0,
    recipientCount,
    estimatedCost,
    maxRecipients:  MAX_RECIPIENTS,
    maxCostInr:     MAX_COST_INR,
    reasons,
  };
}

// ============================================================
// BATCH CRUD
// All functions are fail-open — DB errors are swallowed.
// ============================================================

/**
 * Create a new batch record.
 * Returns the created row, or null on DB error.
 */
async function createBatch({ organizationId, batchType, recipientCount, status = 'PENDING' }) {
  const estimatedCost = estimateCost(recipientCount);
  try {
    const { rows } = await pool.query(
      `INSERT INTO outbound_message_batches
         (organization_id, batch_type, recipient_count, estimated_cost, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [organizationId ?? null, batchType, recipientCount, estimatedCost, status]
    );
    return rows[0];
  } catch (err) {
    logger.error('messageBatch: createBatch failed (fail-open)', {
      organizationId,
      batchType,
      recipientCount,
      error: err.message,
    });
    return null;
  }
}

/**
 * Update batch status.
 * Never throws — silently swallows DB errors.
 */
async function updateBatchStatus(batchId, status) {
  if (!batchId) return;
  try {
    await pool.query(
      `UPDATE outbound_message_batches
       SET    status     = $1,
              updated_at = NOW()
       WHERE  id = $2`,
      [status, batchId]
    );
  } catch (err) {
    logger.error('messageBatch: updateBatchStatus failed (fail-open)', {
      batchId,
      status,
      error: err.message,
    });
  }
}

module.exports = {
  checkThresholds,
  createBatch,
  updateBatchStatus,
  // Expose constants for callers that need to show limits in responses
  MAX_RECIPIENTS,
  MAX_COST_INR,
  COST_PER_MSG,
};
