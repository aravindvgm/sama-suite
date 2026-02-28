const express = require("express");
// mergeParams: true is required so req.params.organizationId set by the
// grandparent app.js route (/api/:organizationId/billing) flows through
// billing.routes.js into this sub-router.
const router = express.Router({ mergeParams: true });

const adjustmentsController = require("./adjustments.controller");
const asyncHandler = require("../../utils/asyncHandler");

// ======================================================
// ADJUSTMENTS ROUTES
// Base path: /api/:organizationId/billing/adjustments
//
// Authentication, organization scoping, and subscription checks
// are applied by tenantStack in app.js and must NOT be repeated here.
// ======================================================

// POST /adjustments
// Request a new adjustment (refund, write-off, credit note)
// Creates PENDING adjustment for admin review
router.post(
  "/",
  asyncHandler(adjustmentsController.requestAdjustment)
);

// POST /adjustments/:adjustmentId/approve
// Approve adjustment (admin only)
router.post(
  "/:adjustmentId/approve",
  asyncHandler(adjustmentsController.approveAdjustment)
);

// POST /adjustments/:adjustmentId/reject
// Reject adjustment — mandatory reason for audit trail
router.post(
  "/:adjustmentId/reject",
  asyncHandler(adjustmentsController.rejectAdjustment)
);

// POST /adjustments/:adjustmentId/reverse
// Reverse an approved adjustment (admin only)
router.post(
  "/:adjustmentId/reverse",
  asyncHandler(adjustmentsController.reverseAdjustment)
);

// GET /adjustments/invoice/:invoiceId
// Full adjustment history for an invoice
router.get(
  "/invoice/:invoiceId",
  asyncHandler(adjustmentsController.getInvoiceAdjustments)
);

// GET /adjustments/pending
// Admin dashboard queue — all awaiting approval
router.get(
  "/pending",
  asyncHandler(adjustmentsController.getPendingAdjustments)
);

module.exports = router;
