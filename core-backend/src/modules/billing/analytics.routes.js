const express = require("express");
const router = express.Router({ mergeParams: true });

const analyticsController = require("./analytics.controller");
const { authorizeOrgRoles } = require("../../middleware/role.middleware");
const asyncHandler = require("../../utils/asyncHandler");

// ======================================================
// ANALYTICS / REPORTS ROUTES
// Base path: /api/:organizationId/reports
//
// Authentication and organization scoping are already applied
// by tenantStack in app.js. They must NOT be repeated per-route.
// Only role authorization is added here since it is route-specific.
// ======================================================

router.post("/revenue-overview",
  authorizeOrgRoles("org_admin"),
  asyncHandler(analyticsController.getRevenueOverview)
);

router.post("/invoice-aging",
  authorizeOrgRoles("org_admin"),
  asyncHandler(analyticsController.getInvoiceAgingReport)
);

router.post("/collection-metrics",
  authorizeOrgRoles("org_admin"),
  asyncHandler(analyticsController.getCollectionRateMetrics)
);

router.post("/payment-distribution",
  authorizeOrgRoles("org_admin"),
  asyncHandler(analyticsController.getPaymentStatusDistribution)
);

router.post("/monthly-trends",
  authorizeOrgRoles("org_admin"),
  asyncHandler(analyticsController.getMonthlyTrends)
);

router.post("/resident-summary",
  authorizeOrgRoles("org_admin"),
  asyncHandler(analyticsController.getResidentSummary)
);

router.post("/export",
  authorizeOrgRoles("org_admin"),
  asyncHandler(analyticsController.exportAnalyticsData)
);

module.exports = router;
