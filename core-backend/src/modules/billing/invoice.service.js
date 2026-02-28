async function updateInvoiceStatus(
  organizationId,
  invoiceId,
  newStatus,
  userId = null,
  reason = null
) {
  // 1️⃣ Get current invoice (org scoped)
  const invoiceResult = await pool.query(
    `
    SELECT id, status, total_amount, due_date
    FROM invoices
    WHERE id = $1 AND organization_id = $2
    `,
    [invoiceId, organizationId]
  );

  if (invoiceResult.rows.length === 0) {
    throw new Error("Invoice not found");
  }

  const invoice = invoiceResult.rows[0];
  const currentStatus = invoice.status;

  // 2️⃣ Defensive status validation
  const allowedStatuses = [
    "DRAFT",
    "SENT",
    "PENDING",
    "PARTIAL",
    "PAID",
    "OVERDUE",
    "CANCELLED"
  ];

  if (!allowedStatuses.includes(newStatus)) {
    throw new Error("Invalid invoice status");
  }

  // 3️⃣ Validate state transition
  stateMachine.validateTransition(currentStatus, newStatus);

  // 4️⃣ Update invoice WITH ORG FILTER
  const updateResult = await pool.query(
    `
    UPDATE invoices
    SET status = $1,
        updated_at = NOW()
    WHERE id = $2
      AND organization_id = $3
    RETURNING *
    `,
    [newStatus, invoiceId, organizationId]
  );

  if (updateResult.rows.length === 0) {
    throw new Error("Invoice update failed");
  }

  const updatedInvoice = updateResult.rows[0];

  // 5️⃣ Optional audit logging
  if (userId) {
    auditService.logInvoiceChange(
      organizationId,
      invoiceId,
      "STATUS_UPDATE",
      { id: userId },
      { previousStatus: currentStatus },
      { newStatus },
      reason || "Status updated",
      null
    );
  }

  return updatedInvoice;
}
