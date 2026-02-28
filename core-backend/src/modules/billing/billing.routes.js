const express = require("express");
const router = express.Router({ mergeParams: true });

const invoiceController = require("./invoice.controller");
const paymentController = require("./payment.controller");
const personController = require("./person.controller");
const adjustmentsRoutes = require("./adjustments.routes");
const roleGuard = require("../../middleware/roleGuard");
const asyncHandler = require("../../utils/asyncHandler");

// ======================================================
// BILLING PROTECTION NOTE
// verifyToken, organizationMiddleware, and requireActiveSubscription
// are already applied by tenantStack in app.js BEFORE this router.
// They must NOT be repeated here — doing so fires verifyToken twice
// and causes requireActiveSubscription to run against a stale request.
// ======================================================


/* ======================================================
   SUB-ROUTER: ADJUSTMENTS
   Mounted here so /api/:organizationId/billing/adjustments/*
   passes through tenantStack exactly once.
   A separate app.use("/api/:organizationId/billing/adjustments")
   in app.js would cause tenantStack to execute a second time
   (Express prefix-matches /billing before /billing/adjustments).
   ====================================================== */

router.use("/adjustments", adjustmentsRoutes);


/* ======================================================
   PERSON ROUTES (Customers)
   ====================================================== */

router.get("/persons",        roleGuard("org_admin", "finance"), asyncHandler(personController.getAllPersons));
router.get("/persons/:id",    roleGuard("org_admin", "finance"), asyncHandler(personController.getPersonById));
router.post("/persons",       roleGuard("org_admin", "finance"), asyncHandler(personController.createPerson));
router.put("/persons/:id",    roleGuard("org_admin", "finance"), asyncHandler(personController.updatePerson));
router.delete("/persons/:id", roleGuard("org_admin"),            asyncHandler(personController.deletePerson));


/* ======================================================
   INVOICE ROUTES
   ====================================================== */

router.post("/invoices",           roleGuard("org_admin", "finance"), asyncHandler(invoiceController.createInvoice));
router.get("/invoices",            roleGuard("org_admin", "finance"), asyncHandler(invoiceController.getAllInvoices));
router.get("/invoices/:id",        roleGuard("org_admin", "finance"), asyncHandler(invoiceController.getInvoice));
router.post("/invoices/:id/send",  roleGuard("org_admin", "finance"), asyncHandler(invoiceController.sendInvoice));


/* ======================================================
   PAYMENT ROUTES
   ====================================================== */

router.get("/payments",              roleGuard("org_admin", "finance"), asyncHandler(paymentController.getAllPayments));
router.post("/payments",             roleGuard("org_admin", "finance"), asyncHandler(paymentController.createPayment));
router.post("/payments/:id/verify",  roleGuard("org_admin"),            asyncHandler(paymentController.verifyPayment));
router.post("/payments/:id/reject",  roleGuard("org_admin"),            asyncHandler(paymentController.rejectPayment));


/* ======================================================
   TEST PROTECTED ROUTE
   ====================================================== */

router.get("/profile", (req, res) => {
  res.json({
    success: true,
    message: "Protected route accessed",
    user: req.user
  });
});

module.exports = router;
