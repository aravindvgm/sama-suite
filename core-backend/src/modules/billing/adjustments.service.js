/**
 * Adjustments Service
 * CA-grade refund and write-off workflow with approval gates and auto-reconciliation
 *
 * Design:
 * - Immutable: Reversals tracked, not hard deletes
 * - Approval-based: Admin approval required before taking effect
 * - Auto-reconciles: Recalculates invoice status on approval
 * - Auditable: Complete who/when/why trail
 */

const pool = require("../../config/db");
const { v4: uuidv4 } = require("uuid");
const auditLogger = require("../audit/auditLogger.service");

function resolveInvoiceStatusFromBalances(paidAmount, outstandingAmount) {
  const paid = parseFloat(paidAmount) || 0;
  const outstanding = parseFloat(outstandingAmount) || 0;

  if (outstanding < 0) {
    return "PAID";
  }

  if (outstanding === 0) {
    return "PAID";
  }

  if (paid > 0 && outstanding > 0) {
    return "PARTIAL";
  }

  return "PENDING";
}

/**
 * Request adjustment (refund, write-off, or credit)
 * Creates PENDING adjustment awaiting admin approval
 *
 * @param {string} organizationId - Organization UUID
 * @param {string} invoiceId - Invoice UUID
 * @param {string} type - 'REFUND' | 'WRITE_OFF' | 'CREDIT_NOTE' | 'CORRECTION'
 * @param {number} amount - Adjustment amount in INR
 * @param {string} reason - Business reason (mandatory)
 * @param {Object} user - {id, orgRole}
 * @param {Object} context - {paymentId for refunds, metadata, ipAddress, requestId}
 * @returns {Promise<Object>} Pending adjustment
 */
async function requestAdjustment(
  organizationId,
  invoiceId,
  type,
  amount,
  reason,
  user,
  context = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const validTypes = ["REFUND", "WRITE_OFF", "CREDIT_NOTE", "CORRECTION"];
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid adjustment type. Must be one of: ${validTypes.join(", ")}`);
    }

    if (type === "REFUND" && !context.paymentId) {
      throw new Error("Refunds must specify payment_id in context");
    }

    const invoiceResult = await client.query(
      `SELECT id, total_amount, status FROM invoices
       WHERE id = $1 AND organization_id = $2`,
      [invoiceId, organizationId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    const adjustmentAmount = parseFloat(amount);

    if (adjustmentAmount <= 0) {
      throw new Error("Adjustment amount must be positive");
    }

    let paymentId = null;
    if (type === "REFUND") {
      paymentId = context.paymentId;
      const paymentResult = await client.query(
        `SELECT id, amount, status FROM payments
         WHERE id = $1 AND invoice_id = $2 AND organization_id = $3`,
        [paymentId, invoiceId, organizationId]
      );

      if (paymentResult.rows.length === 0) {
        throw new Error("Payment not found for this invoice");
      }

      const payment = paymentResult.rows[0];
      if (payment.status !== "VERIFIED") {
        throw new Error(`Can only refund VERIFIED payments. This payment is ${payment.status}`);
      }

      const approvedRefundsResult = await client.query(
        `SELECT COALESCE(SUM(amount), 0) as approved_refunds
         FROM adjustments
         WHERE organization_id = $1
           AND payment_id = $2
           AND type = 'REFUND'
           AND status = 'APPROVED'`,
        [organizationId, paymentId]
      );

      const approvedRefunds = parseFloat(approvedRefundsResult.rows[0].approved_refunds) || 0;
      const paymentAmount = parseFloat(payment.amount) || 0;

      if (approvedRefunds + adjustmentAmount > paymentAmount) {
        throw new Error(
          `Cumulative refund amount (INR ${approvedRefunds + adjustmentAmount}) exceeds payment (INR ${paymentAmount})`
        );
      }
    }

    const adjustmentId = uuidv4();

    const adjustmentResult = await client.query(
      `INSERT INTO adjustments (
        id, organization_id, invoice_id, payment_id,
        type, amount, status, reason,
        requested_by, metadata,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'PENDING', $7,
        $8, $9, NOW(), NOW()
      ) RETURNING *`,
      [
        adjustmentId,
        organizationId,
        invoiceId,
        paymentId,
        type,
        adjustmentAmount,
        reason,
        user.id,
        context.metadata ? JSON.stringify(context.metadata) : null
      ]
    );

    await client.query("COMMIT");

    const adjustment = adjustmentResult.rows[0];

    auditLogger.logEvent({
      organizationId,
      entityType: "ADJUSTMENT",
      entityId:   adjustmentId,
      action:     "ADJUSTMENT_REQUESTED",
      actor:      { type: "USER", userId: user.id },
      reason:     `${type} requested: ${reason}`,
      meta: {
        adjustmentType: type,
        amount:         adjustmentAmount,
        invoiceId,
        ...context,
      },
    });

    return {
      adjustment,
      message: `${type} approval pending. Amount: INR ${adjustmentAmount}`
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Approve adjustment and apply changes
 * CRITICAL: Wrapped in transaction with auto-reconciliation
 * - Mark adjustment as APPROVED
 * - For REFUND: Mark payment metadata and record REFUND ledger entry
 * - For WRITE_OFF: Record WRITE_OFF ledger entry
 * - Recalculate invoice status from invoice_balances_view
 *
 * @param {string} organizationId - Organization UUID
 * @param {string} adjustmentId - Adjustment UUID
 * @param {Object} user - {id, orgRole}
 * @param {string} notes - Approval notes (optional)
 * @param {Object} context - {ipAddress, requestId}
 * @returns {Promise<Object>} {adjustment, invoice}
 */
async function approveAdjustment(
  organizationId,
  adjustmentId,
  user,
  notes = null,
  context = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const adjustmentResult = await client.query(
      `SELECT * FROM adjustments WHERE id = $1 AND organization_id = $2`,
      [adjustmentId, organizationId]
    );

    if (adjustmentResult.rows.length === 0) {
      throw new Error("Adjustment not found");
    }

    const adjustment = adjustmentResult.rows[0];

    if (adjustment.status !== "PENDING") {
      throw new Error(`Can only approve PENDING adjustments. This is ${adjustment.status}`);
    }

    const adjustmentAmount = parseFloat(adjustment.amount);
    const adjustmentType = adjustment.type;

    if (adjustmentType === "REFUND") {
      const refundPaymentResult = await client.query(
        `UPDATE payments
         SET status = 'REFUNDED',
             is_refunded = TRUE,
             refunded_amount = $1,
             refunded_at = NOW(),
             refund_reason = $2,
             updated_at = NOW()
         WHERE id = $3
           AND invoice_id = $4
           AND organization_id = $5`,
        [
          adjustmentAmount,
          `Refund approved. ${notes || ""}`,
          adjustment.payment_id,
          adjustment.invoice_id,
          organizationId
        ]
      );

      if (refundPaymentResult.rowCount === 0) {
        throw new Error("Payment not found for this invoice");
      }

      const refundLedgerResult = await client.query(
        `INSERT INTO ledger_entries (
           id,
           organization_id,
           entry_type,
           debit_account,
           credit_account,
           amount,
           reference_type,
           reference_id,
           source_invoice_id,
           source_payment_id,
           created_at
         ) VALUES (
           $1,
           $2,
           'REFUND',
           'ACCOUNTS_RECEIVABLE',
           'CASH',
           $3,
           'adjustment',
           $4,
           $5,
           $6,
           NOW()
         ) RETURNING id`,
        [
          uuidv4(),
          organizationId,
          adjustmentAmount,
          adjustmentId,
          adjustment.invoice_id,
          adjustment.payment_id
        ]
      );

      if (refundLedgerResult.rowCount === 0) {
        throw new Error("Failed to insert refund ledger entry");
      }
    } else if (adjustmentType === "WRITE_OFF") {
      const writeOffLedgerResult = await client.query(
        `INSERT INTO ledger_entries (
           id,
           organization_id,
           entry_type,
           debit_account,
           credit_account,
           amount,
           reference_type,
           reference_id,
           source_invoice_id,
           source_payment_id,
           created_at
         ) VALUES (
           $1,
           $2,
           'WRITE_OFF',
           'BAD_DEBT_EXPENSE',
           'ACCOUNTS_RECEIVABLE',
           $3,
           'adjustment',
           $4,
           $5,
           NULL,
           NOW()
         ) RETURNING id`,
        [
          uuidv4(),
          organizationId,
          adjustmentAmount,
          adjustmentId,
          adjustment.invoice_id
        ]
      );

      if (writeOffLedgerResult.rowCount === 0) {
        throw new Error("Failed to insert write-off ledger entry");
      }
    }

    const invoiceBalanceResult = await client.query(
      `SELECT
         COALESCE(ibv.paid_amount, 0) as paid_amount,
         COALESCE(ibv.outstanding_amount, i.total_amount) as outstanding_amount
       FROM invoices i
       LEFT JOIN invoice_balances_view ibv
         ON ibv.organization_id = i.organization_id
        AND ibv.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [adjustment.invoice_id, organizationId]
    );

    if (invoiceBalanceResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    const newInvoiceStatus = resolveInvoiceStatusFromBalances(
      invoiceBalanceResult.rows[0].paid_amount,
      invoiceBalanceResult.rows[0].outstanding_amount
    );

    const oldInvoiceStatusResult = await client.query(
      `SELECT status FROM invoices WHERE id = $1 AND organization_id = $2`,
      [adjustment.invoice_id, organizationId]
    );

    if (oldInvoiceStatusResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    const oldInvoiceStatus = oldInvoiceStatusResult.rows[0].status;

    const approvedResult = await client.query(
      `UPDATE adjustments
       SET status = 'APPROVED',
           approved_by = $1,
           approved_at = NOW(),
           approval_notes = $2,
           previous_invoice_status = $3,
           new_invoice_status = $4,
           updated_at = NOW()
       WHERE id = $5
         AND organization_id = $6
       RETURNING *`,
      [user.id, notes || null, oldInvoiceStatus, newInvoiceStatus, adjustmentId, organizationId]
    );

    if (approvedResult.rowCount === 0) {
      throw new Error("Adjustment not found");
    }

    const approvedAdjustment = approvedResult.rows[0];

    if (newInvoiceStatus !== oldInvoiceStatus) {
      const updateInvoiceResult = await client.query(
        `UPDATE invoices
         SET status = $1, updated_at = NOW()
         WHERE id = $2
           AND organization_id = $3`,
        [newInvoiceStatus, adjustment.invoice_id, organizationId]
      );

      if (updateInvoiceResult.rowCount === 0) {
        throw new Error("Invoice not found");
      }
    }

    const updatedInvoiceResult = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND organization_id = $2`,
      [adjustment.invoice_id, organizationId]
    );

    if (updatedInvoiceResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    await client.query("COMMIT");

    const updatedInvoice = updatedInvoiceResult.rows[0];

    auditLogger.logEvent({
      organizationId,
      entityType: "ADJUSTMENT",
      entityId:   adjustmentId,
      action:     "ADJUSTMENT_APPROVED",
      actor:      { type: "USER", userId: user.id },
      reason:     `${adjustmentType} approved. ${notes || "Invoice status auto-updated."}`,
      meta: {
        adjustmentType,
        amount:    adjustmentAmount,
        invoiceId: adjustment.invoice_id,
        ...context,
      },
    });

    return {
      adjustment: approvedAdjustment,
      invoice: updatedInvoice,
      message: `${adjustmentType} approved. Invoice status: ${oldInvoiceStatus} -> ${newInvoiceStatus}`
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reject adjustment with mandatory reason
 *
 * @param {string} organizationId - Organization UUID
 * @param {string} adjustmentId - Adjustment UUID
 * @param {Object} user - {id, orgRole}
 * @param {string} reason - Rejection reason (mandatory)
 * @param {Object} context - {ipAddress, requestId}
 * @returns {Promise<Object>} Rejected adjustment
 */
async function rejectAdjustment(
  organizationId,
  adjustmentId,
  user,
  reason,
  context = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!reason) {
      throw new Error("Rejection reason is mandatory for audit compliance");
    }

    const adjustmentResult = await client.query(
      `SELECT * FROM adjustments WHERE id = $1 AND organization_id = $2`,
      [adjustmentId, organizationId]
    );

    if (adjustmentResult.rows.length === 0) {
      throw new Error("Adjustment not found");
    }

    const adjustment = adjustmentResult.rows[0];

    if (adjustment.status !== "PENDING") {
      throw new Error("Can only reject PENDING adjustments");
    }

    const rejectedResult = await client.query(
      `UPDATE adjustments
       SET status = 'REJECTED',
           rejected_by = $1,
           rejected_at = NOW(),
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3
         AND organization_id = $4
       RETURNING *`,
      [user.id, reason, adjustmentId, organizationId]
    );

    if (rejectedResult.rowCount === 0) {
      throw new Error("Adjustment not found");
    }

    await client.query("COMMIT");

    const rejectedAdjustment = rejectedResult.rows[0];

    auditLogger.logEvent({
      organizationId,
      entityType: "ADJUSTMENT",
      entityId:   adjustmentId,
      action:     "ADJUSTMENT_REJECTED",
      actor:      { type: "USER", userId: user.id },
      reason:     `${adjustment.type} rejected: ${reason}`,
      meta: {
        adjustmentType: adjustment.type,
        amount:         parseFloat(adjustment.amount),
        invoiceId:      adjustment.invoice_id,
        ...context,
      },
    });

    return rejectedAdjustment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reverse an approved adjustment
 * Immutable: Creates reversal record, doesn't delete
 *
 * @param {string} organizationId - Organization UUID
 * @param {string} adjustmentId - Adjustment UUID to reverse
 * @param {Object} user - {id, orgRole}
 * @param {string} reason - Reason for reversal
 * @param {Object} context - {ipAddress, requestId}
 * @returns {Promise<Object>} Reversed adjustment
 */
async function reverseAdjustment(
  organizationId,
  adjustmentId,
  user,
  reason,
  context = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (!reason) {
      throw new Error("Reversal reason is required");
    }

    const adjustmentResult = await client.query(
      `SELECT * FROM adjustments WHERE id = $1 AND organization_id = $2`,
      [adjustmentId, organizationId]
    );

    if (adjustmentResult.rows.length === 0) {
      throw new Error("Adjustment not found");
    }

    const adjustment = adjustmentResult.rows[0];

    if (adjustment.status !== "APPROVED") {
      throw new Error("Can only reverse APPROVED adjustments");
    }

    if (adjustment.is_reversed) {
      throw new Error("This adjustment has already been reversed");
    }

    const reversedResult = await client.query(
      `UPDATE adjustments
       SET is_reversed = TRUE,
           reversed_by = $1,
           reversed_at = NOW(),
           reversal_reason = $2,
           status = 'REVERSED',
           updated_at = NOW()
       WHERE id = $3
         AND organization_id = $4
       RETURNING *`,
      [user.id, reason, adjustmentId, organizationId]
    );

    if (reversedResult.rowCount === 0) {
      throw new Error("Adjustment not found");
    }

    const adjustmentAmount = parseFloat(adjustment.amount);

    if (adjustment.type === "REFUND") {
      const reversePaymentResult = await client.query(
        `UPDATE payments
         SET is_refunded = FALSE,
             refunded_amount = NULL,
             refunded_at = NULL,
             refund_reason = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND invoice_id = $2
           AND organization_id = $3`,
        [adjustment.payment_id, adjustment.invoice_id, organizationId]
      );

      if (reversePaymentResult.rowCount === 0) {
        throw new Error("Payment not found for this invoice");
      }

      const reverseRefundLedgerResult = await client.query(
        `INSERT INTO ledger_entries (
           id,
           organization_id,
           entry_type,
           debit_account,
           credit_account,
           amount,
           reference_type,
           reference_id,
           source_invoice_id,
           source_payment_id,
           created_at
         ) VALUES (
           $1,
           $2,
           'PAYMENT_RECEIVED',
           'CASH',
           'ACCOUNTS_RECEIVABLE',
           $3,
           'adjustment',
           $4,
           $5,
           $6,
           NOW()
         ) RETURNING id`,
        [
          uuidv4(),
          organizationId,
          adjustmentAmount,
          adjustmentId,
          adjustment.invoice_id,
          adjustment.payment_id
        ]
      );

      if (reverseRefundLedgerResult.rowCount === 0) {
        throw new Error("Failed to insert refund reversal ledger entry");
      }
    } else if (adjustment.type === "WRITE_OFF") {
      const reverseWriteOffLedgerResult = await client.query(
        `INSERT INTO ledger_entries (
           id,
           organization_id,
           entry_type,
           debit_account,
           credit_account,
           amount,
           reference_type,
           reference_id,
           source_invoice_id,
           source_payment_id,
           created_at
         ) VALUES (
           $1,
           $2,
           'CREDIT_APPLIED',
           'ACCOUNTS_RECEIVABLE',
           'BAD_DEBT_EXPENSE',
           $3,
           'adjustment',
           $4,
           $5,
           NULL,
           NOW()
         ) RETURNING id`,
        [
          uuidv4(),
          organizationId,
          adjustmentAmount,
          adjustmentId,
          adjustment.invoice_id
        ]
      );

      if (reverseWriteOffLedgerResult.rowCount === 0) {
        throw new Error("Failed to insert write-off reversal ledger entry");
      }
    }

    const invoiceBalanceResult = await client.query(
      `SELECT
         COALESCE(ibv.paid_amount, 0) as paid_amount,
         COALESCE(ibv.outstanding_amount, i.total_amount) as outstanding_amount
       FROM invoices i
       LEFT JOIN invoice_balances_view ibv
         ON ibv.organization_id = i.organization_id
        AND ibv.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [adjustment.invoice_id, organizationId]
    );

    if (invoiceBalanceResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    const newInvoiceStatus = resolveInvoiceStatusFromBalances(
      invoiceBalanceResult.rows[0].paid_amount,
      invoiceBalanceResult.rows[0].outstanding_amount
    );

    const updateInvoiceResult = await client.query(
      `UPDATE invoices
       SET status = $1, updated_at = NOW()
       WHERE id = $2
         AND organization_id = $3`,
      [newInvoiceStatus, adjustment.invoice_id, organizationId]
    );

    if (updateInvoiceResult.rowCount === 0) {
      throw new Error("Invoice not found");
    }

    await client.query("COMMIT");

    const reversedAdjustment = reversedResult.rows[0];

    auditLogger.logEvent({
      organizationId,
      entityType: "ADJUSTMENT",
      entityId:   adjustmentId,
      action:     "ADJUSTMENT_REVERSED",
      actor:      { type: "USER", userId: user.id },
      reason:     `${adjustment.type} reversed: ${reason}`,
      meta: {
        adjustmentType: adjustment.type,
        amount:         parseFloat(adjustment.amount),
        invoiceId:      adjustment.invoice_id,
        ...context,
      },
    });

    return reversedAdjustment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get adjustment history for an invoice
 *
 * @param {string} organizationId - Organization UUID
 * @param {string} invoiceId - Invoice UUID
 * @returns {Promise<Array>} All adjustments for invoice
 */
async function getInvoiceAdjustments(organizationId, invoiceId) {
  const result = await pool.query(
    `SELECT * FROM adjustments
     WHERE organization_id = $1 AND invoice_id = $2
     ORDER BY requested_at DESC`,
    [organizationId, invoiceId]
  );

  return result.rows;
}

/**
 * Get pending adjustments for admin review
 *
 * @param {string} organizationId - Organization UUID
 * @returns {Promise<Array>} All PENDING adjustments
 */
async function getPendingAdjustments(organizationId) {
  const result = await pool.query(
    `SELECT * FROM adjustments
     WHERE organization_id = $1 AND status = 'PENDING'
     ORDER BY requested_at ASC`,
    [organizationId]
  );

  return result.rows;
}

module.exports = {
  requestAdjustment,
  approveAdjustment,
  rejectAdjustment,
  reverseAdjustment,
  getInvoiceAdjustments,
  getPendingAdjustments
};
