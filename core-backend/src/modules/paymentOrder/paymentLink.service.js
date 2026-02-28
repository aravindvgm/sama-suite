'use strict';

const crypto                = require('crypto');
const pool                  = require('../../config/db');
const { createPaymentOrder } = require('./paymentOrder.service');

const LINK_BASE_URL   = process.env.PAY_LINK_BASE_URL || 'https://sama9.com/pay';
const EXPIRY_HOURS    = 48;

// ============================================================
// HELPERS
// ============================================================

function generateToken() {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex, opaque
}

function expiresAt() {
  const d = new Date();
  d.setHours(d.getHours() + EXPIRY_HOURS);
  return d;
}

/**
 * Confirm the student_fee belongs to this organization.
 * Throws 404 with statusCode if not found.
 */
async function assertFeeOwnership(client, { studentFeeId, organizationId }) {
  const { rows } = await client.query(
    `SELECT id
     FROM   student_fees
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [studentFeeId, organizationId]
  );

  if (rows.length === 0) {
    const err = new Error('Student fee record not found in this organization');
    err.statusCode = 404;
    throw err;
  }
}

// ============================================================
// CREATE PAYMENT LINK
// ============================================================

/**
 * generatePaymentLink({ organizationId, userId, studentFeeId, amount, paymentMethod })
 *
 * 1. Validates fee belongs to organization.
 * 2. Creates a PENDING payment order via paymentOrder.service.
 * 3. Mints a secure, opaque token (does not encode studentId).
 * 4. Persists token → payment_links with 48-hour expiry.
 * 5. Returns the full pay-now URL.
 *
 * @returns {Promise<{
 *   paymentLinkUrl: string,
 *   token:          string,
 *   expiresAt:      string,   // ISO-8601
 *   paymentId:      string,
 *   gatewayOrderId: string,
 *   amount:         number,
 * }>}
 */
async function generatePaymentLink({
  organizationId,
  userId,
  studentFeeId,
  amount,
  paymentMethod,
}) {
  // ── Step 1: Ownership check ───────────────────────────────
  const client = await pool.connect();
  try {
    await assertFeeOwnership(client, { studentFeeId, organizationId });
  } finally {
    client.release();
  }

  // ── Step 2: Create payment order (validates balance, amount) ─
  const order = await createPaymentOrder({
    organizationId,
    userId,
    studentFeeId,
    amount,
    paymentMethod,
  });

  // ── Step 3: Mint token & persist ─────────────────────────
  const token   = generateToken();
  const expiry  = expiresAt();

  await pool.query(
    `INSERT INTO payment_links
       (organization_id, student_fee_id, payment_id, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [organizationId, studentFeeId, order.paymentId, token, expiry]
  );

  return {
    paymentLinkUrl: `${LINK_BASE_URL}/${token}`,
    token,
    expiresAt:      expiry.toISOString(),
    paymentId:      order.paymentId,
    gatewayOrderId: order.gatewayOrderId,
    amount:         order.amount,
  };
}

// ============================================================
// RESOLVE TOKEN  (used by the validation / checkout API)
// ============================================================

/**
 * resolvePaymentLink(token)
 *
 * Looks up a payment link by token.
 * Throws 404 if not found, 410 if expired.
 *
 * @returns {Promise<{
 *   id:             string,
 *   organizationId: string,
 *   studentFeeId:   string,
 *   paymentId:      string,
 *   expiresAt:      string,
 * }>}
 */
async function resolvePaymentLink(token) {
  const { rows } = await pool.query(
    `SELECT id, organization_id, student_fee_id, payment_id, expires_at
     FROM   payment_links
     WHERE  token = $1`,
    [token]
  );

  if (rows.length === 0) {
    const err = new Error('Payment link not found');
    err.statusCode = 404;
    throw err;
  }

  const link = rows[0];

  if (new Date() > new Date(link.expires_at)) {
    const err = new Error('Payment link has expired');
    err.statusCode = 410;
    throw err;
  }

  return {
    id:             link.id,
    organizationId: link.organization_id,
    studentFeeId:   link.student_fee_id,
    paymentId:      link.payment_id,
    expiresAt:      new Date(link.expires_at).toISOString(),
  };
}

module.exports = { generatePaymentLink, resolvePaymentLink };
