/**
 * Payment Service
 * Production-grade payment verification with strict financial integrity
 *
 * Design philosophy:
 * - Idempotent: External payment IDs are unique per org (no duplicate marking)
 * - Transactional: Payment + invoice status update in single DB transaction
 * - Immutable: No hard deletes, soft deletes via refund tracking
 * - Reconcilable: Sum of verified payments must match invoice status
 * - Auditable: Every payment action logged with full context
 */

const pool = require("../../config/db");
const { v4: uuidv4 } = require("uuid");
const auditService = require("./audit.service");

/**
 * Create a payment record (idempotent via external_payment_id)
 *
 * Idempotency: If external_payment_id already exists, return existing payment
 * Validates: Invoice in payable state, amount not exceeding remaining balance
 */
async function createPayment(
  organizationId,
  invoiceId,
  amount,
  paymentMethod,
  externalPaymentId,
  paymentDate,
  user,
  context = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingPayment = await client.query(
      `SELECT id, amount, status FROM payments
       WHERE organization_id = $1 AND external_payment_id = $2`,
      [organizationId, externalPaymentId]
    );

    if (existingPayment.rows.length > 0) {
      await client.query("COMMIT");
      return {
        isNew: false,
        payment: existingPayment.rows[0],
        message: `Payment with external ID ${externalPaymentId} already exists (idempotent)`
      };
    }

    const invoiceResult = await client.query(
      `SELECT
         i.id,
         i.status,
         i.total_amount,
         COALESCE(ibv.outstanding_amount, i.total_amount) as outstanding_amount
       FROM invoices i
       LEFT JOIN invoice_balances_view ibv
         ON ibv.organization_id = i.organization_id
        AND ibv.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [invoiceId, organizationId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    const invoice = invoiceResult.rows[0];
    const payableStates = ['PENDING', 'PARTIAL', 'OVERDUE'];

    if (!payableStates.includes(invoice.status)) {
      throw new Error(
        `Cannot accept payment for invoice in ${invoice.status} state. ` +
        `Only ${payableStates.join(', ')} invoices accept payments.`
      );
    }

    const remainingBalance = parseFloat(invoice.outstanding_amount) || 0;
    const invoiceTotal = parseFloat(invoice.total_amount);
    const paymentAmount = parseFloat(amount);

    if (paymentAmount <= 0) {
      throw new Error("Payment amount must be greater than 0");
    }

    if (paymentAmount > invoiceTotal) {
      throw new Error(
        `Payment exceeds invoice total of INR ${invoiceTotal}`
      );
    }

    if (paymentAmount > remainingBalance) {
      throw new Error(
        `Payment (INR ${paymentAmount}) exceeds remaining balance (INR ${remainingBalance})`
      );
    }

    const paymentId = uuidv4();
    const parsedPaymentDate = new Date(paymentDate);

    const paymentResult = await client.query(
      `INSERT INTO payments (
        id, organization_id, invoice_id, amount, payment_method,
        external_payment_id, payment_date, status, proof_url,
        proof_metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_VERIFICATION', $8, $9, NOW(), NOW())
      RETURNING *`,
      [
        paymentId,
        organizationId,
        invoiceId,
        paymentAmount,
        paymentMethod,
        externalPaymentId,
        parsedPaymentDate,
        context.proofUrl || null,
        context.proofMetadata ? JSON.stringify(context.proofMetadata) : null
      ]
    );

    await client.query("COMMIT");

    const payment = paymentResult.rows[0];

    auditService.logPaymentAction(
      organizationId,
      paymentId,
      "CREATE",
      user,
      {
        before: {},
        after: { amount: paymentAmount, status: "PENDING_VERIFICATION" }
      },
      "PENDING_VERIFICATION",
      `Payment recorded. Remaining balance after verification: INR ${remainingBalance - paymentAmount}`,
      context
    );

    return {
      isNew: true,
      payment,
      remainingBalance: remainingBalance - paymentAmount,
      percentageOfInvoice: ((paymentAmount / invoiceTotal) * 100).toFixed(2)
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Verify payment and auto-update invoice status
 *
 * CRITICAL: Wrapped in DB transaction for atomicity
 * - Marks payment as VERIFIED
 * - Recalculates invoice status from sum of all verified payments
 * - Logs to audit trail
 */
async function verifyPayment(
  organizationId,
  paymentId,
  user,
  notes = null,
  context = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND organization_id = $2`,
      [paymentId, organizationId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error("Payment not found");
    }

    const payment = paymentResult.rows[0];

    if (payment.status !== "PENDING_VERIFICATION") {
      throw new Error(`Cannot verify payment in ${payment.status} state`);
    }

    const previousPaymentState = { ...payment };

    const verifiedResult = await client.query(
      `UPDATE payments
       SET status = 'VERIFIED',
           verified_by = $1,
           verified_at = NOW(),
           verification_notes = $2,
           updated_at = NOW()
       WHERE id = $3
         AND organization_id = $4
       RETURNING *`,
      [user.id, notes || null, paymentId, organizationId]
    );

    if (verifiedResult.rowCount === 0) {
      throw new Error("Payment not found");
    }

    const verifiedPayment = verifiedResult.rows[0];

    const invoiceBalanceResult = await client.query(
      `SELECT
         i.id,
         i.status,
         i.total_amount,
         COALESCE(ibv.outstanding_amount, i.total_amount) as outstanding_amount,
         (i.total_amount - COALESCE(ibv.outstanding_amount, i.total_amount)) as collected_amount
       FROM invoices i
       LEFT JOIN invoice_balances_view ibv
         ON ibv.organization_id = i.organization_id
        AND ibv.invoice_id = i.id
       WHERE i.id = $1 AND i.organization_id = $2`,
      [payment.invoice_id, organizationId]
    );

    if (invoiceBalanceResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    const invoice = invoiceBalanceResult.rows[0];
    const invoiceTotal = parseFloat(invoice.total_amount);
    const totalCollected = parseFloat(invoice.collected_amount) || 0;
    const remainingBalance = parseFloat(invoice.outstanding_amount) || 0;

    let newInvoiceStatus = invoice.status;
    if (remainingBalance <= 0) {
      newInvoiceStatus = "PAID";
    } else if (totalCollected > 0) {
      newInvoiceStatus = "PARTIAL";
    }

    if (newInvoiceStatus !== invoice.status) {
      const invoiceUpdateResult = await client.query(
        `UPDATE invoices
         SET status = $1, updated_at = NOW()
         WHERE id = $2
           AND organization_id = $3`,
        [newInvoiceStatus, payment.invoice_id, organizationId]
      );

      if (invoiceUpdateResult.rowCount === 0) {
        throw new Error("Invoice not found");
      }
    }

    const updatedInvoiceResult = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND organization_id = $2`,
      [payment.invoice_id, organizationId]
    );

    if (updatedInvoiceResult.rows.length === 0) {
      throw new Error("Invoice not found");
    }

    await client.query("COMMIT");

    const updatedInvoice = updatedInvoiceResult.rows[0];

    auditService.logPaymentAction(
      organizationId,
      paymentId,
      "VERIFY",
      user,
      { before: previousPaymentState, after: verifiedPayment },
      "VERIFIED",
      notes || "Payment verified",
      context
    );

    if (newInvoiceStatus !== invoice.status) {
      auditService.logInvoiceChange(
        organizationId,
        payment.invoice_id,
        "UPDATE",
        user,
        { status: invoice.status },
        { status: newInvoiceStatus, collected: totalCollected },
        `Auto-updated on payment verification. Collected: INR ${totalCollected} / INR ${invoiceTotal}`,
        context
      );
    }

    return {
      payment: verifiedPayment,
      invoice: updatedInvoice,
      reconciliation: {
        invoiceTotal,
        totalCollected,
        remainingBalance,
        collectionPercentage: invoiceTotal > 0 ? ((totalCollected / invoiceTotal) * 100).toFixed(2) : "0.00"
      }
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Reject payment with mandatory reason
 */
async function rejectPayment(
  organizationId,
  paymentId,
  user,
  reason,
  context = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `SELECT * FROM payments WHERE id = $1 AND organization_id = $2`,
      [paymentId, organizationId]
    );

    if (paymentResult.rows.length === 0) {
      throw new Error("Payment not found");
    }

    const payment = paymentResult.rows[0];

    if (payment.status !== "PENDING_VERIFICATION") {
      throw new Error(`Cannot reject payment in ${payment.status} state`);
    }

    if (!reason) {
      throw new Error("Rejection reason is required for audit compliance");
    }

    const previousState = { ...payment };

    const rejectedResult = await client.query(
      `UPDATE payments
       SET status = 'REJECTED',
           rejected_by = $1,
           rejected_at = NOW(),
           rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3
         AND organization_id = $4
       RETURNING *`,
      [user.id, reason, paymentId, organizationId]
    );

    if (rejectedResult.rowCount === 0) {
      throw new Error("Payment not found");
    }

    await client.query("COMMIT");

    const rejectedPayment = rejectedResult.rows[0];

    auditService.logPaymentAction(
      organizationId,
      paymentId,
      "REJECT",
      user,
      { before: previousState, after: rejectedPayment },
      "REJECTED",
      reason,
      context
    );

    return rejectedPayment;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get reconciliation report for an invoice
 */
async function getInvoiceReconciliation(organizationId, invoiceId) {
  const invoiceResult = await pool.query(
    `SELECT
       i.id,
       i.total_amount,
       i.status,
       COALESCE(ibv.paid_amount, 0) as paid_amount,
       COALESCE(ibv.refunded_amount, 0) as refunded_amount,
       COALESCE(ibv.outstanding_amount, i.total_amount) as outstanding_amount
     FROM invoices i
     LEFT JOIN invoice_balances_view ibv
       ON ibv.organization_id = i.organization_id
      AND ibv.invoice_id = i.id
     WHERE i.id = $1 AND i.organization_id = $2`,
    [invoiceId, organizationId]
  );

  if (invoiceResult.rows.length === 0) {
    throw new Error("Invoice not found");
  }

  const invoice = invoiceResult.rows[0];
  const invoiceTotal = parseFloat(invoice.total_amount);
  const totalVerified = parseFloat(invoice.paid_amount) || 0;
  const totalRefunded = parseFloat(invoice.refunded_amount) || 0;
  const remainingBalance = parseFloat(invoice.outstanding_amount) || 0;

  const paymentsResult = await pool.query(
    `SELECT
      status,
      SUM(CASE WHEN is_refunded = FALSE THEN amount ELSE 0 END) as active_amount,
      SUM(CASE WHEN is_refunded = TRUE THEN refunded_amount ELSE 0 END) as refunded_amount,
      COUNT(*) as count
    FROM payments
    WHERE invoice_id = $1 AND organization_id = $2
    GROUP BY status`,
    [invoiceId, organizationId]
  );

  const paymentsBreakdown = {};

  paymentsResult.rows.forEach((row) => {
    const activeAmount = parseFloat(row.active_amount) || 0;
    const refundedAmount = parseFloat(row.refunded_amount) || 0;

    paymentsBreakdown[row.status] = {
      count: row.count,
      activeAmount,
      refundedAmount
    };
  });

  const reconciliationStatus =
    remainingBalance <= 0 ? "FULLY_PAID" :
    totalVerified > 0 ? "PARTIALLY_PAID" :
    "UNPAID";

  return {
    invoice: {
      id: invoice.id,
      total: invoiceTotal,
      status: invoice.status
    },
    payments: paymentsBreakdown,
    summary: {
      totalVerified,
      totalRefunded,
      netCollected: totalVerified - totalRefunded,
      remainingBalance: Math.max(0, remainingBalance),
      collectionPercentage: invoiceTotal > 0 ? ((totalVerified / invoiceTotal) * 100).toFixed(2) : "0.00",
      reconciliationStatus
    },
    isReconciled: remainingBalance <= 0 && invoice.status === "PAID"
  };
}

/**
 * Verify audit integrity against duplicate payments
 */
async function verifyPaymentIntegrity(organizationId, externalPaymentId) {
  const result = await pool.query(
    `SELECT COUNT(*) as verified_count FROM payments
     WHERE organization_id = $1 AND external_payment_id = $2 AND status = 'VERIFIED'`,
    [organizationId, externalPaymentId]
  );

  if (result.rows[0].verified_count > 1) {
    return {
      status: "error",
      message: "CRITICAL: Multiple verified payments for same external ID",
      duplicateCount: result.rows[0].verified_count
    };
  }

  return { status: "ok", message: "No duplicates detected" };
}

module.exports = {
  createPayment,
  verifyPayment,
  rejectPayment,
  getInvoiceReconciliation,
  verifyPaymentIntegrity
};
