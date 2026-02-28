'use strict';

const pool                   = require('../../config/db');
const { resolvePaymentLink } = require('./paymentLink.service');

// ============================================================
// HELPERS
// ============================================================

/**
 * Fetches all checkout data in a single JOIN query.
 * Returns null if any required record is missing.
 */
async function fetchCheckoutData({ organizationId, studentFeeId, paymentId }) {
  // ── Fee + student + enrollment + class + section + fee structure ──
  const { rows: feeRows } = await pool.query(
    `SELECT
       st.first_name                              AS student_first_name,
       st.last_name                               AS student_last_name,
       cl.class_name                              AS class_name,
       sc.section_name                            AS section_name,
       en.academic_year,
       fs.fee_name,
       sf.amount                                  AS fee_amount,
       COALESCE(
         (SELECT SUM(p2.amount)
          FROM   payments p2
          WHERE  p2.student_fee_id  = sf.id
            AND  p2.organization_id = sf.organization_id
            AND  p2.status          = 'SUCCESS'
            AND  p2.deleted_at IS NULL
         ), 0
       )                                          AS total_paid,
       org.name                                   AS organization_name,
       org.logo_path                              AS organization_logo
     FROM   student_fees   sf
     JOIN   fee_structures fs ON fs.id = sf.fee_structure_id AND fs.deleted_at IS NULL
     JOIN   students       st ON st.id = sf.student_id       AND st.deleted_at IS NULL
     JOIN   enrollments    en ON en.student_id = st.id
                              AND en.organization_id = sf.organization_id
                              AND en.deleted_at IS NULL
     JOIN   classes        cl ON cl.id = en.class_id         AND cl.deleted_at IS NULL
     JOIN   sections       sc ON sc.id = en.section_id       AND sc.deleted_at IS NULL
     JOIN   organizations  org ON org.id = sf.organization_id
     WHERE  sf.id              = $1
       AND  sf.organization_id = $2
       AND  sf.deleted_at IS NULL`,
    [studentFeeId, organizationId]
  );

  if (feeRows.length === 0) return null;

  // ── Payment record ────────────────────────────────────────
  const { rows: payRows } = await pool.query(
    `SELECT id, status, gateway_order_id, amount
     FROM   payments
     WHERE  id              = $1
       AND  organization_id = $2
       AND  deleted_at IS NULL`,
    [paymentId, organizationId]
  );

  if (payRows.length === 0) return null;

  return { fee: feeRows[0], payment: payRows[0] };
}

// ============================================================
// CONTROLLER
// ============================================================

async function getPaymentLinkCheckout(req, res) {
  const { token } = req.params;

  // ── Step 1: Resolve token (throws 404 / 410 on invalid/expired) ──
  let link;
  try {
    link = await resolvePaymentLink(token);
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message,
    });
  }

  const { organizationId, studentFeeId, paymentId } = link;

  // ── Step 2: Fetch checkout data ───────────────────────────
  let data;
  try {
    data = await fetchCheckoutData({ organizationId, studentFeeId, paymentId });
  } catch (err) {
    console.error('[PaymentLinkPublic] DB error fetching checkout data:', err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }

  if (!data) {
    return res.status(404).json({
      success: false,
      message: 'Payment or fee record no longer exists',
    });
  }

  const { fee, payment } = data;

  // ── Step 3: Validate payment is still PENDING ─────────────
  if (payment.status !== 'PENDING') {
    const reason =
      payment.status === 'SUCCESS'
        ? 'This payment has already been completed'
        : 'This payment link is no longer valid';

    return res.status(422).json({ success: false, message: reason });
  }

  // ── Step 4: Build checkout payload (no sensitive data) ────
  const feeAmount  = parseFloat(fee.fee_amount);
  const totalPaid  = parseFloat(fee.total_paid);
  const balance    = parseFloat((feeAmount - totalPaid).toFixed(2));

  return res.status(200).json({
    success: true,
    data: {
      organizationName:  fee.organization_name,
      organizationLogo:  fee.organization_logo || null,
      studentName:       `${fee.student_first_name} ${fee.student_last_name}`.trim(),
      class:             fee.class_name,
      section:           fee.section_name,
      academicYear:      fee.academic_year,
      feeName:           fee.fee_name,
      feeAmount,
      totalPaid,
      balance,
      paymentId:         payment.id,
      gatewayOrderId:    payment.gateway_order_id,
      expiresAt:         link.expiresAt,
    },
  });
}

module.exports = { getPaymentLinkCheckout };
