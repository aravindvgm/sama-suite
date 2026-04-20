const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const app = express();


// TRUST PROXY (required for Render / reverse proxies)
app.set("trust proxy", 1);


// ======================================================
// CORS CONFIGURATION (before helmet and routes)
// ======================================================

const allowedOrigins = [
  "http://localhost:4200",
  "https://sama-suite-dev.netlify.app"
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


// ======================================================
// SECURITY
// ======================================================

app.use(helmet());


// ======================================================
// REQUEST TRACING + STRUCTURED LOGGING
// ======================================================

const requestId     = require("./middleware/requestId.middleware");
const requestLogger = require("./middleware/requestLogger.middleware");

app.use(requestId);
app.use(requestLogger);


// ======================================================
// BODY PARSERS
// ======================================================

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
// ======================================================

const verifyToken   = require("./middleware/auth.middleware");
const requireTenant = require("./middleware/organization.middleware");
const requireActiveSubscription = require("./middleware/requireActiveSubscription");
const rateLimitMiddleware = require("./middleware/rateLimit.middleware");


// ======================================================
// ROUTE MODULES
// ======================================================

const authRoutes        = require("./modules/auth/auth.routes");
const meRoutes          = require("./modules/me/me.routes");
const billingRoutes     = require("./modules/billing/billing.routes");
const analyticsRoutes   = require("./modules/billing/analytics.routes");
const usersRoutes       = require("./modules/users/users.routes");
const securityRoutes    = require("./modules/security/security.routes");
const classesRoutes     = require("./modules/classes/classes.routes");
const enrollmentsRoutes = require("./modules/enrollments/enrollments.routes");
const attendanceRoutes  = require("./modules/attendance/attendance.routes");
const adminDashboardRoutes = require("./modules/admin/adminDashboard.routes");


// ======================================================
// PUBLIC AUTH ROUTES
// ======================================================

app.use("/api/auth", authLimiter, authRoutes);


// ======================================================
// AUTHENTICATED USER ROUTES
// ======================================================

app.use("/api/users", verifyToken, meRoutes);


// ======================================================
// TENANT STACK
// ======================================================

const tenantStack = [
  verifyToken,
  tenantLimiter,
  requireTenant,
  rateLimitMiddleware,
  requireActiveSubscription
];


// ======================================================
// BILLING ROUTES
// ======================================================

app.use("/api/:organizationId/billing", tenantStack, billingRoutes);


// ======================================================
// ANALYTICS ROUTES
// ======================================================

app.use("/api/:organizationId/reports", tenantStack, analyticsRoutes);


// ======================================================
// SECURITY ROUTES
// ======================================================

app.use("/api/:organizationId/security", tenantStack, securityRoutes);


// ======================================================
// ATTENDANCE ROUTES
// ======================================================

app.use("/api/:organizationId/classes", tenantStack, classesRoutes);
app.use("/api/:organizationId/enrollments", tenantStack, enrollmentsRoutes);
app.use("/api/:organizationId/attendance", tenantStack, attendanceRoutes);


// ======================================================
// ORG USER ROUTES
// ======================================================

app.use("/api/org", verifyToken, usersRoutes);

// ======================================================
// BASIC ADMIN EXAMPLE (ROLE-BASED)
// ======================================================

app.use("/api/admin", adminDashboardRoutes);


// ======================================================
// HEALTH CHECKS (VERY IMPORTANT FOR RENDER / MONITORING)
// ======================================================

// Root health
app.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "SAMA-SUITE Backend",
    company: "Sama Technologies",
    status: "running"
  });
});

// API root
app.get("/api", (_req, res) => {
  res.json({
    success: true,
    service: "SAMA-SUITE API",
    status: "running"
  });
});

// health probe
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

// Simple alive check (public)
app.get("/health", (_req, res) => {
  return res.json({
    success: true,
    message: "Server is running"
  });
});


// ======================================================
// DEMO HEALTH (LOCALHOST ONLY)
// ======================================================

const demoHealthRoutes = require("./modules/system/demoHealth.routes");
app.use("/health/demo", demoHealthRoutes);


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
// ======================================================

const errorHandler = require("./middleware/error.middleware");
app.use(errorHandler);


module.exports = app;