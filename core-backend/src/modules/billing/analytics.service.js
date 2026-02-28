const pool = require("../../config/db");

/**
 * Get Revenue Overview
 * Returns: total revenue, monthly breakdown, average invoice value, growth rate
 */
async function getRevenueOverview(organizationId, startDate, endDate) {
  if (!organizationId) {
    throw new Error("Organization context is required");
  }

  const result = await pool.query(
    `
    WITH payment_by_invoice AS (
      SELECT
        le.source_invoice_id AS invoice_id,
        SUM(le.amount) as collected_amount
      FROM ledger_entries le
      WHERE le.organization_id = $1
        AND le.entry_type = 'PAYMENT_RECEIVED'
        AND le.created_at >= $2
        AND le.created_at <= $3
        AND le.source_invoice_id IS NOT NULL
      GROUP BY le.source_invoice_id
    )
    SELECT
      COUNT(*) as invoice_count,
      SUM(collected_amount) as total_revenue,
      AVG(collected_amount) as avg_invoice_value
    FROM payment_by_invoice
    `,
    [organizationId, startDate, endDate]
  );

  const monthlyData = await pool.query(
    `
    SELECT
      DATE_TRUNC('month', le.created_at)::DATE as month,
      COUNT(DISTINCT le.source_invoice_id) as invoice_count,
      SUM(le.amount) as revenue
    FROM ledger_entries le
    WHERE le.organization_id = $1
      AND le.entry_type = 'PAYMENT_RECEIVED'
      AND le.created_at >= $2
      AND le.created_at <= $3
      AND le.source_invoice_id IS NOT NULL
    GROUP BY DATE_TRUNC('month', le.created_at)
    ORDER BY month DESC
    `,
    [organizationId, startDate, endDate]
  );

  const row = result.rows[0] || {};
  const previousPeriodResult = await pool.query(
    `
    SELECT SUM(le.amount) as prev_revenue
    FROM ledger_entries le
    WHERE le.organization_id = $1
      AND le.entry_type = 'PAYMENT_RECEIVED'
      AND le.created_at >= DATE($2) - INTERVAL '1 year'
      AND le.created_at < $2
    `,
    [organizationId, startDate]
  );

  const currentRevenue = parseFloat(row.total_revenue) || 0;
  const previousRevenue = parseFloat(previousPeriodResult.rows[0]?.prev_revenue) || 0;
  const growthRate = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;

  return {
    summary: {
      totalRevenue: currentRevenue,
      invoiceCount: Number.parseInt(row.invoice_count, 10) || 0,
      avgInvoiceValue: parseFloat(row.avg_invoice_value) || 0,
      growthRatePercentage: parseFloat(growthRate.toFixed(2))
    },
    monthlyBreakdown: monthlyData.rows.map((monthRow) => ({
      month: monthRow.month,
      revenue: parseFloat(monthRow.revenue) || 0,
      invoiceCount: Number.parseInt(monthRow.invoice_count, 10) || 0
    }))
  };
}

/**
 * Get Invoice Aging Report
 * Returns: invoice count and amount by age brackets
 */
async function getInvoiceAgingReport(organizationId) {
  if (!organizationId) {
    throw new Error("Organization context is required");
  }

  const result = await pool.query(
    `
    SELECT
      CASE
        WHEN CURRENT_DATE - i.due_date <= 30 THEN '0-30 days'
        WHEN CURRENT_DATE - i.due_date <= 60 THEN '30-60 days'
        WHEN CURRENT_DATE - i.due_date <= 90 THEN '60-90 days'
        ELSE '90+ days'
      END as age_bracket,
      COUNT(*) as invoice_count,
      SUM(ibv.outstanding_amount) as total_amount
    FROM invoices i
    JOIN invoice_balances_view ibv
      ON ibv.organization_id = i.organization_id
     AND ibv.invoice_id = i.id
    WHERE i.organization_id = $1
      AND i.status NOT IN ('DRAFT', 'CANCELLED')
      AND i.due_date <= CURRENT_DATE
      AND ibv.outstanding_amount > 0
    GROUP BY age_bracket
    ORDER BY
      CASE
        WHEN age_bracket = '0-30 days' THEN 1
        WHEN age_bracket = '30-60 days' THEN 2
        WHEN age_bracket = '60-90 days' THEN 3
        ELSE 4
      END
    `,
    [organizationId]
  );

  const brackets = {
    '0-30days': { count: 0, amount: 0 },
    '30-60days': { count: 0, amount: 0 },
    '60-90days': { count: 0, amount: 0 },
    '90+days': { count: 0, amount: 0 }
  };

  result.rows.forEach((resultRow) => {
    const bracketKey = resultRow.age_bracket.replace(/\s+/g, '');
    if (brackets[bracketKey]) {
      brackets[bracketKey] = {
        count: Number.parseInt(resultRow.invoice_count, 10) || 0,
        amount: parseFloat(resultRow.total_amount) || 0
      };
    }
  });

  return brackets;
}

/**
 * Get Collection Rate Metrics
 * Returns: collection %, days to collect, collected vs outstanding
 */
async function getCollectionRateMetrics(organizationId, period = 'all') {
  if (!organizationId) {
    throw new Error("Organization context is required");
  }

  let dateFilter = '';

  if (period === 'monthly') {
    dateFilter = 'AND DATE_TRUNC(\'month\', i.created_at) = DATE_TRUNC(\'month\', CURRENT_DATE)';
  } else if (period === 'quarterly') {
    dateFilter = 'AND DATE_TRUNC(\'quarter\', i.created_at) = DATE_TRUNC(\'quarter\', CURRENT_DATE)';
  } else if (period === 'yearly') {
    dateFilter = 'AND EXTRACT(YEAR FROM i.created_at) = EXTRACT(YEAR FROM CURRENT_DATE)';
  }

  const metricsResult = await pool.query(
    `
    SELECT
      COUNT(*) as total_invoices,
      SUM(i.total_amount - ibv.outstanding_amount) as collected_amount,
      SUM(ibv.outstanding_amount) as outstanding_amount,
      SUM(
        CASE
          WHEN i.status = 'PARTIAL' OR (i.total_amount - ibv.outstanding_amount) > 0
            THEN i.total_amount - ibv.outstanding_amount
          ELSE 0
        END
      ) as partial_amount
    FROM invoices i
    JOIN invoice_balances_view ibv
      ON ibv.organization_id = i.organization_id
     AND ibv.invoice_id = i.id
    WHERE i.organization_id = $1
      AND i.status NOT IN ('DRAFT', 'CANCELLED')
      ${dateFilter}
    `,
    [organizationId]
  );

  const row = metricsResult.rows[0] || {};
  const collectedAmount = parseFloat(row.collected_amount) || 0;
  const outstandingAmount = parseFloat(row.outstanding_amount) || 0;
  const partialAmount = parseFloat(row.partial_amount) || 0;
  const totalAmount = collectedAmount + outstandingAmount;

  const collectionRate = totalAmount > 0 ? (collectedAmount / totalAmount) * 100 : 0;

  const daysResult = await pool.query(
    `
    SELECT
      CEIL(AVG(EXTRACT(DAY FROM (i.updated_at - i.created_at)))) as avg_days_to_collect
    FROM invoices i
    JOIN invoice_balances_view ibv
      ON ibv.organization_id = i.organization_id
     AND ibv.invoice_id = i.id
    WHERE i.organization_id = $1
      AND ibv.outstanding_amount <= 0
      ${dateFilter}
    `,
    [organizationId]
  );

  const avgDaysToCollect = Number.parseInt(daysResult.rows[0]?.avg_days_to_collect, 10) || 0;

  return {
    collectionRatePercentage: parseFloat(collectionRate.toFixed(2)),
    avgDaysToCollect,
    collectedAmount: parseFloat(collectedAmount.toFixed(2)),
    outstandingAmount: parseFloat(outstandingAmount.toFixed(2)),
    partialAmount: parseFloat(partialAmount.toFixed(2)),
    totalInvoices: Number.parseInt(row.total_invoices, 10) || 0
  };
}

/**
 * Get Payment Status Distribution
 * Returns: count and amount breakdown by invoice status
 */
async function getPaymentStatusDistribution(organizationId) {
  if (!organizationId) {
    throw new Error("Organization context is required");
  }

  const result = await pool.query(
    `
    SELECT
      i.status,
      COUNT(*) as invoice_count,
      SUM(i.total_amount) as total_amount
    FROM invoices i
    WHERE i.organization_id = $1
    GROUP BY i.status
    ORDER BY total_amount DESC
    `,
    [organizationId]
  );

  const distribution = {
    PAID: { count: 0, amount: 0 },
    PARTIAL: { count: 0, amount: 0 },
    PENDING: { count: 0, amount: 0 },
    OVERDUE: { count: 0, amount: 0 },
    SENT: { count: 0, amount: 0 },
    DRAFT: { count: 0, amount: 0 },
    CANCELLED: { count: 0, amount: 0 }
  };

  result.rows.forEach((resultRow) => {
    if (distribution[resultRow.status]) {
      distribution[resultRow.status] = {
        count: Number.parseInt(resultRow.invoice_count, 10) || 0,
        amount: parseFloat(resultRow.total_amount) || 0
      };
    }
  });

  return distribution;
}

/**
 * Get Monthly Trends
 * Returns: month-by-month revenue, invoice count, and collection rate
 */
async function getMonthlyTrends(organizationId, months = 12) {
  if (!organizationId) {
    throw new Error("Organization context is required");
  }

  const result = await pool.query(
    `
    WITH monthly_data AS (
      SELECT
        DATE_TRUNC('month', i.created_at)::DATE as month,
        COUNT(*) as invoice_count,
        SUM(i.total_amount) as total_amount,
        SUM(i.total_amount - ibv.outstanding_amount) as collected_amount
      FROM invoices i
      JOIN invoice_balances_view ibv
        ON ibv.organization_id = i.organization_id
       AND ibv.invoice_id = i.id
      WHERE i.organization_id = $1
        AND i.status NOT IN ('DRAFT', 'CANCELLED')
        AND i.created_at >= CURRENT_DATE - INTERVAL '1' MONTH * $2
      GROUP BY DATE_TRUNC('month', i.created_at)
    ),
    monthly_revenue AS (
      SELECT
        DATE_TRUNC('month', le.created_at)::DATE as month,
        SUM(le.amount) as revenue
      FROM ledger_entries le
      WHERE le.organization_id = $1
        AND le.entry_type = 'PAYMENT_RECEIVED'
        AND le.created_at >= CURRENT_DATE - INTERVAL '1' MONTH * $2
      GROUP BY DATE_TRUNC('month', le.created_at)
    )
    SELECT
      md.month,
      md.invoice_count,
      COALESCE(mr.revenue, 0) as revenue,
      md.collected_amount,
      ROUND(
        CASE
          WHEN md.total_amount > 0 THEN (md.collected_amount / md.total_amount) * 100
          ELSE 0
        END, 2
      ) as collection_rate_percentage
    FROM monthly_data md
    LEFT JOIN monthly_revenue mr
      ON mr.month = md.month
    ORDER BY md.month DESC
    `,
    [organizationId, months]
  );

  return result.rows.map((resultRow) => ({
    month: resultRow.month,
    revenue: parseFloat(resultRow.revenue) || 0,
    invoiceCount: Number.parseInt(resultRow.invoice_count, 10) || 0,
    collectedAmount: parseFloat(resultRow.collected_amount) || 0,
    collectionRatePercentage: parseFloat(resultRow.collection_rate_percentage) || 0
  }));
}

/**
 * Get Per-Resident Summary
 * Optional drill-down by individual resident/customer
 */
async function getResidentSummary(organizationId, limit = 50) {
  if (!organizationId) {
    throw new Error("Organization context is required");
  }

  const result = await pool.query(
    `
    SELECT
      i.person_id,
      COUNT(*) as invoice_count,
      SUM(i.total_amount) as total_amount,
      SUM(i.total_amount - ibv.outstanding_amount) as collected_amount,
      SUM(ibv.outstanding_amount) as outstanding_amount
    FROM invoices i
    JOIN invoice_balances_view ibv
      ON ibv.organization_id = i.organization_id
     AND ibv.invoice_id = i.id
    WHERE i.organization_id = $1
    GROUP BY i.person_id
    ORDER BY outstanding_amount DESC
    LIMIT $2
    `,
    [organizationId, limit]
  );

  return result.rows.map((resultRow) => {
    const totalAmount = parseFloat(resultRow.total_amount) || 0;
    const collectedAmount = parseFloat(resultRow.collected_amount) || 0;
    const collectionRate = totalAmount > 0 ? (collectedAmount / totalAmount) * 100 : 0;

    return {
      personId: resultRow.person_id,
      invoiceCount: Number.parseInt(resultRow.invoice_count, 10) || 0,
      totalAmount,
      collectedAmount,
      outstandingAmount: parseFloat(resultRow.outstanding_amount) || 0,
      collectionRatePercentage: parseFloat(collectionRate.toFixed(2)) || 0
    };
  });
}

module.exports = {
  getRevenueOverview,
  getInvoiceAgingReport,
  getCollectionRateMetrics,
  getPaymentStatusDistribution,
  getMonthlyTrends,
  getResidentSummary
};
