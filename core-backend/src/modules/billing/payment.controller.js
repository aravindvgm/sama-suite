// modules/billing/payment.controller.js

const pool = require("../../config/db");

/* ================= GET ALL PAYMENTS ================= */
const getAllPayments = async (req, res) => {
  const { organizationId } = req.params;

  const result = await pool.query(
    `SELECT *
     FROM payments
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [organizationId]
  );

  res.json({
    success: true,
    data: result.rows
  });
};

/* ================= CREATE PAYMENT ================= */
const createPayment = async (req, res) => {
  const { organizationId } = req.params;
  const { invoice_id, amount, method } = req.body;

  const result = await pool.query(
    `INSERT INTO payments
     (organization_id, invoice_id, amount, method, status)
     VALUES ($1, $2, $3, $4, 'PENDING')
     RETURNING *`,
    [organizationId, invoice_id, amount, method]
  );

  res.status(201).json({
    success: true,
    data: result.rows[0]
  });
};

/* ================= VERIFY PAYMENT ================= */
const verifyPayment = async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE payments
     SET status = 'VERIFIED'
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  res.json({
    success: true,
    data: result.rows[0]
  });
};

/* ================= REJECT PAYMENT ================= */
const rejectPayment = async (req, res) => {
  const { id } = req.params;

  const result = await pool.query(
    `UPDATE payments
     SET status = 'REJECTED'
     WHERE id = $1
     RETURNING *`,
    [id]
  );

  res.json({
    success: true,
    data: result.rows[0]
  });
};

module.exports = {
  getAllPayments,
  createPayment,
  verifyPayment,
  rejectPayment
};
