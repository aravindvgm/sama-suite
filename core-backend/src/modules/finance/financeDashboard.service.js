'use strict';

const pool = require('../../config/db');

/**
 * getFinanceDashboard({ organizationId })
 *
 * Single query — all five KPIs in one pass using conditional aggregation.
 *
 * todayCollection       — SUM of SUCCESS payments paid today
 * monthCollection       — SUM of SUCCESS payments paid this calendar month
 * pendingBalance        — SUM of (fee_amount - paid) across all non-PAID student_fees
 * failedPayments        — COUNT of FAILED payment rows (lifetime, non-deleted)
 * pendingReconcileCount — COUNT of PENDING payments older than 10 minutes
 *                         (likely stale gateway orders that never received a webhook)
 */
async function getFinanceDashboard({ organizationId }) {
  const [collectionResult, pendingBalanceResult, pendingReconcileResult] = await Promise.all([

    // ── Collections + failed count ────────────────────────────
    pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (
           WHERE status = 'SUCCESS'
             AND DATE(paid_at) = CURRENT_DATE
         ), 0)                                                    AS today_collection,

         COALESCE(SUM(amount) FILTER (
           WHERE status = 'SUCCESS'
             AND DATE_TRUNC('month', paid_at) = DATE_TRUNC('month', CURRENT_DATE)
         ), 0)                                                    AS month_collection,

         COUNT(*) FILTER (WHERE status = 'FAILED')               AS failed_payments
       FROM payments
       WHERE organization_id = $1
         AND deleted_at IS NULL`,
      [organizationId]
    ),

    // ── Pending balance across all unpaid fees ────────────────
    pool.query(
      `SELECT COALESCE(
         SUM(sf.amount) - COALESCE(SUM(paid.total_paid), 0)
       , 0) AS pending_balance
       FROM student_fees sf
       LEFT JOIN (
         SELECT student_fee_id, SUM(amount) AS total_paid
         FROM   payments
         WHERE  organization_id = $1
           AND  status          = 'SUCCESS'
           AND  deleted_at IS NULL
         GROUP  BY student_fee_id
       ) paid ON paid.student_fee_id = sf.id
       WHERE sf.organization_id = $1
         AND sf.status         != 'PAID'
         AND sf.deleted_at IS NULL`,
      [organizationId]
    ),

    // ── Stale PENDING payments (no webhook after 10 min) ─────
    pool.query(
      `SELECT COUNT(*) AS pending_reconcile_count
       FROM   payments
       WHERE  organization_id = $1
         AND  status          = 'PENDING'
         AND  created_at      < NOW() - INTERVAL '10 minutes'
         AND  deleted_at IS NULL`,
      [organizationId]
    ),
  ]);

  const c = collectionResult.rows[0];

  return {
    todayCollection:       parseFloat(c.today_collection),
    monthCollection:       parseFloat(c.month_collection),
    pendingBalance:        parseFloat(pendingBalanceResult.rows[0].pending_balance),
    failedPayments:        parseInt(c.failed_payments, 10),
    pendingReconcileCount: parseInt(pendingReconcileResult.rows[0].pending_reconcile_count, 10),
  };
}

module.exports = { getFinanceDashboard };
