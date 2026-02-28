const analyticsService = require("./analytics.service");

/**
 * Get Revenue Overview Dashboard
 * Includes: total revenue, monthly trends, average invoice value, growth rate
 */
async function getRevenueOverview(req, res) {
  try {
    const { organizationId } = req.params;
    const { startDate, endDate } = req.query;

    // Validate date parameters
    let parsedStartDate = new Date();
    let parsedEndDate = new Date();

    if (startDate) {
      parsedStartDate = new Date(startDate);
      if (isNaN(parsedStartDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid startDate format. Use YYYY-MM-DD"
        });
      }
    } else {
      // Default to 1 year ago
      parsedStartDate = new Date();
      parsedStartDate.setFullYear(parsedStartDate.getFullYear() - 1);
    }

    if (endDate) {
      parsedEndDate = new Date(endDate);
      if (isNaN(parsedEndDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid endDate format. Use YYYY-MM-DD"
        });
      }
    }

    const data = await analyticsService.getRevenueOverview(
      organizationId,
      parsedStartDate,
      parsedEndDate
    );

    res.json({
      success: true,
      message: "Revenue overview retrieved successfully",
      data: {
        period: {
          startDate: parsedStartDate.toISOString().split('T')[0],
          endDate: parsedEndDate.toISOString().split('T')[0]
        },
        ...data,
        metadata: {
          generatedAt: new Date().toISOString(),
          currency: "INR"
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get Invoice Aging Report
 * Breakdown: 0-30, 30-60, 60-90, 90+ days overdue
 */
async function getInvoiceAgingReport(req, res) {
  try {
    const { organizationId } = req.params;

    const data = await analyticsService.getInvoiceAgingReport(organizationId);

    res.json({
      success: true,
      message: "Invoice aging report retrieved successfully",
      data: {
        agingBrackets: data,
        totalOutstanding: Object.values(data).reduce((sum, bracket) => sum + bracket.amount, 0),
        totalInvoices: Object.values(data).reduce((sum, bracket) => sum + bracket.count, 0),
        metadata: {
          generatedAt: new Date().toISOString(),
          currency: "INR"
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get Collection Rate Metrics
 * Includes: collection %, days to collect, collected vs outstanding
 */
async function getCollectionRateMetrics(req, res) {
  try {
    const { organizationId } = req.params;
    const { period } = req.query;

    // Validate period parameter
    const validPeriods = ['all', 'monthly', 'quarterly', 'yearly'];
    const selectedPeriod = validPeriods.includes(period) ? period : 'all';

    const data = await analyticsService.getCollectionRateMetrics(organizationId, selectedPeriod);

    res.json({
      success: true,
      message: "Collection rate metrics retrieved successfully",
      data: {
        period: selectedPeriod,
        ...data,
        metadata: {
          generatedAt: new Date().toISOString(),
          currency: "INR"
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get Payment Status Distribution
 * Breakdown by status: PAID, PARTIAL, PENDING, OVERDUE, SENT, DRAFT, CANCELLED
 */
async function getPaymentStatusDistribution(req, res) {
  try {
    const { organizationId } = req.params;

    const data = await analyticsService.getPaymentStatusDistribution(organizationId);

    // Calculate totals
    const totalAmount = Object.values(data).reduce((sum, status) => sum + status.amount, 0);
    const totalInvoices = Object.values(data).reduce((sum, status) => sum + status.count, 0);

    res.json({
      success: true,
      message: "Payment status distribution retrieved successfully",
      data: {
        statusBreakdown: data,
        summary: {
          totalAmount,
          totalInvoices
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          currency: "INR"
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get Monthly Trends
 * Month-by-month revenue, invoice count, and collection rate
 */
async function getMonthlyTrends(req, res) {
  try {
    const { organizationId } = req.params;
    const { months = 12 } = req.query;

    // Validate months parameter
    const numericMonths = Math.min(Math.max(parseInt(months) || 12, 1), 36); // Limit to 3 years max

    const data = await analyticsService.getMonthlyTrends(organizationId, numericMonths);

    res.json({
      success: true,
      message: "Monthly trends retrieved successfully",
      data: {
        period: `Last ${numericMonths} months`,
        trends: data,
        summary: {
          totalRevenue: data.reduce((sum, month) => sum + month.revenue, 0),
          totalInvoices: data.reduce((sum, month) => sum + month.invoiceCount, 0),
          averageCollectionRate: (
            data.reduce((sum, month) => sum + month.collectionRatePercentage, 0) / data.length
          ).toFixed(2)
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          currency: "INR"
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Get Resident Summary (Optional drill-down)
 * Per-resident outstanding and payment status
 */
async function getResidentSummary(req, res) {
  try {
    const { organizationId } = req.params;
    const { limit = 50 } = req.query;

    // Validate limit parameter
    const numericLimit = Math.min(Math.max(parseInt(limit) || 50, 1), 1000);

    const data = await analyticsService.getResidentSummary(organizationId, numericLimit);

    res.json({
      success: true,
      message: "Resident summary retrieved successfully",
      data: {
        residents: data,
        summary: {
          totalResidents: data.length,
          totalOutstanding: data.reduce((sum, resident) => sum + resident.outstandingAmount, 0),
          averageCollectionRate: (
            data.reduce((sum, resident) => sum + resident.collectionRatePercentage, 0) / data.length
          ).toFixed(2)
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          currency: "INR"
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Export Analytics Data
 * Supports JSON and CSV formats
 */
async function exportAnalyticsData(req, res) {
  try {
    const { organizationId } = req.params;
    const { format = 'json', reportType = 'summary', startDate, endDate } = req.query;

    // Validate format
    if (!['json', 'csv'].includes(format)) {
      return res.status(400).json({
        success: false,
        message: "Invalid format. Use 'json' or 'csv'"
      });
    }

    // Fetch appropriate data based on report type
    let reportData = {};

    let parsedStartDate = new Date();
    let parsedEndDate = new Date();

    if (startDate) {
      parsedStartDate = new Date(startDate);
      if (isNaN(parsedStartDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid startDate format. Use YYYY-MM-DD"
        });
      }
    } else {
      parsedStartDate = new Date();
      parsedStartDate.setFullYear(parsedStartDate.getFullYear() - 1);
    }

    if (endDate) {
      parsedEndDate = new Date(endDate);
      if (isNaN(parsedEndDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid endDate format. Use YYYY-MM-DD"
        });
      }
    }

    switch (reportType) {
      case 'revenue':
        reportData = await analyticsService.getRevenueOverview(
          organizationId,
          parsedStartDate,
          parsedEndDate
        );
        break;
      case 'aging':
        reportData = await analyticsService.getInvoiceAgingReport(organizationId);
        break;
      case 'collection':
        reportData = await analyticsService.getCollectionRateMetrics(organizationId, 'all');
        break;
      case 'status':
        reportData = await analyticsService.getPaymentStatusDistribution(organizationId);
        break;
      case 'trends':
        reportData = await analyticsService.getMonthlyTrends(organizationId, 12);
        break;
      case 'summary':
      default:
        reportData = {
          revenue: await analyticsService.getRevenueOverview(
            organizationId,
            parsedStartDate,
            parsedEndDate
          ),
          aging: await analyticsService.getInvoiceAgingReport(organizationId),
          collection: await analyticsService.getCollectionRateMetrics(organizationId, 'all'),
          status: await analyticsService.getPaymentStatusDistribution(organizationId),
          trends: await analyticsService.getMonthlyTrends(organizationId, 12)
        };
    }

    if (format === 'json') {
      res.json({
        success: true,
        message: "Report exported successfully",
        data: reportData,
        metadata: {
          reportType,
          generatedAt: new Date().toISOString(),
          currency: "INR"
        }
      });
    } else if (format === 'csv') {
      // CSV export logic
      const csvContent = convertToCSV(reportData, reportType);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="analytics_${reportType}_${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csvContent);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * Helper function to convert data to CSV
 */
function convertToCSV(data, reportType) {
  let csv = '';

  switch (reportType) {
    case 'revenue':
      csv = 'Month,Revenue,Invoice Count\n';
      if (data.monthlyBreakdown) {
        data.monthlyBreakdown.forEach(month => {
          csv += `${month.month},${month.revenue},${month.invoiceCount}\n`;
        });
      }
      break;

    case 'aging':
      csv = 'Age Bracket,Count,Amount\n';
      Object.entries(data).forEach(([bracket, values]) => {
        csv += `${bracket},${values.count},${values.amount}\n`;
      });
      break;

    case 'collection':
      csv = 'Metric,Value\n';
      csv += `Collection Rate %,${data.collectionRatePercentage}\n`;
      csv += `Average Days to Collect,${data.avgDaysToCollect}\n`;
      csv += `Collected Amount,${data.collectedAmount}\n`;
      csv += `Outstanding Amount,${data.outstandingAmount}\n`;
      break;

    case 'status':
      csv = 'Status,Count,Amount\n';
      Object.entries(data).forEach(([status, values]) => {
        csv += `${status},${values.count},${values.amount}\n`;
      });
      break;

    case 'trends':
      csv = 'Month,Revenue,Invoice Count,Collection Rate %,Collected Amount\n';
      if (Array.isArray(data)) {
        data.forEach(month => {
          csv += `${month.month},${month.revenue},${month.invoiceCount},${month.collectionRatePercentage},${month.collectedAmount}\n`;
        });
      }
      break;

    case 'summary':
    default:
      csv = 'Report Summary\n\n';
      csv += 'Revenue Overview\n';
      csv += convertToCSV(data.revenue, 'revenue');
      csv += '\n\nInvoice Aging\n';
      csv += convertToCSV(data.aging, 'aging');
      csv += '\n\nCollection Metrics\n';
      csv += convertToCSV(data.collection, 'collection');
      csv += '\n\nPayment Status Distribution\n';
      csv += convertToCSV(data.status, 'status');
      csv += '\n\nMonthly Trends\n';
      csv += convertToCSV(data.trends, 'trends');
      break;
  }

  return csv;
}

module.exports = {
  getRevenueOverview,
  getInvoiceAgingReport,
  getCollectionRateMetrics,
  getPaymentStatusDistribution,
  getMonthlyTrends,
  getResidentSummary,
  exportAnalyticsData
};
