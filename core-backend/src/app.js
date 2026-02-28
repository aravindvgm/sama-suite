const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();


// TRUST PROXY
app.set("trust proxy", 1);


// SECURITY
app.use(helmet());

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:4200",
  credentials: true
}));


// ======================================================
// REQUEST TRACING + STRUCTURED LOGGING
// requestId must run before requestLogger so the ID is
// available on req when the finish-event handler fires.
// Both run before body parsers so every request is traced,
// including those rejected by size/content-type guards.
// ======================================================

const requestId     = require("./middleware/requestId.middleware");
const requestLogger = require("./middleware/requestLogger.middleware");

app.use(requestId);
app.use(requestLogger);


// BODY PARSERS
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));


// ======================================================
// RATE LIMITERS
// ======================================================

const { apiLimiter, authLimiter } = require("./middleware/rateLimiter");
const tenantLimiter = require("./middleware/tenantRateLimiter");

app.use("/api", apiLimiter);


// ======================================================
// MIDDLEWARE SINGLETONS
// Each is required once and reused — not imported per-file.
// ======================================================

const verifyToken = require("./middleware/auth.middleware");
const requireTenant = require("./middleware/organization.middleware");
const requireActiveSubscription = require("./middleware/requireActiveSubscription");


// ======================================================
// ROUTE MODULES
// ======================================================

const authRoutes = require("./modules/auth/auth.routes");
const meRoutes = require("./modules/me/me.routes");
const billingRoutes = require("./modules/billing/billing.routes");
const analyticsRoutes = require("./modules/billing/analytics.routes");
const usersRoutes = require("./modules/users/users.routes");


// ======================================================
// PUBLIC AUTH ROUTES
// POST /api/auth/:organizationId/register
// POST /api/auth/:organizationId/login
// ======================================================

app.use("/api/auth", authLimiter, authRoutes);


// ======================================================
// AUTHENTICATED USER ROUTES
// GET /api/users/me
// GET /api/users/me/organizations
// verifyToken runs once here — meRoutes must NOT re-verify.
// ======================================================

app.use("/api/users", verifyToken, meRoutes);


// ======================================================
// TENANT-SCOPED STACK
// verifyToken → tenantLimiter → requireTenant → requireActiveSubscription
// Applied once per request. Sub-routers must NOT duplicate these.
// ======================================================

const tenantStack = [
  verifyToken,
  tenantLimiter,
  requireTenant,
  requireActiveSubscription
];


// ======================================================
// BILLING ROUTES
// /api/:organizationId/billing/...
// NOTE: adjustments are mounted as a sub-router inside billingRoutes,
//       so there is NO separate app.use for /billing/adjustments here.
//       That would cause tenantStack to execute twice.
// ======================================================

app.use("/api/:organizationId/billing", tenantStack, billingRoutes);


// ======================================================
// ANALYTICS / REPORTS ROUTES
// /api/:organizationId/reports/...
// ======================================================

app.use("/api/:organizationId/reports", tenantStack, analyticsRoutes);


// ======================================================
// ORG USER ROUTES
// /api/org/:organizationId/users
// verifyToken runs once here — usersRoutes must NOT re-verify.
// ======================================================

app.use("/api/org", verifyToken, usersRoutes);


// ======================================================
// HEALTH CHECK
// ======================================================

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "Sama Technologies Core Backend Running"
  });
});


// ======================================================
// 404 FALLTHROUGH
// ======================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});


// ======================================================
// GLOBAL ERROR HANDLER
// Must be last and have 4 parameters.
// ======================================================

const errorHandler = require("./middleware/error.middleware");
app.use(errorHandler);


module.exports = app;
