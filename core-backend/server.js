"use strict";

/**
 * Canonical Express application for SAMA-SUITE core-backend.
 *
 * Mounted by index.js (production / Render) and re-exported by src/server.js
 * for backwards compatibility.
 *
 * Route order matters: register literal paths (health, root) before any
 * routers that use dynamic segments under /api.
 */

// Ensure DB pool is initialised before route modules that depend on it
require("./src/config/db");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const { authLimiter } = require("./src/middleware/rateLimiter");
const authRoutes = require("./src/modules/auth/auth.routes");
const apiRouter = require("./routes/index");

const app = express();

app.set("trust proxy", 1);

// ---------------------------------------------------------------------------
// CORS — allow server-to-server / curl (no Origin) + known frontends + Render
// ---------------------------------------------------------------------------
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:4200",
  "http://127.0.0.1:4200",
  "https://sama-suite-dev.netlify.app",
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith(".onrender.com")) return true;
  } catch {
    return false;
  }
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(helmet());

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ---------------------------------------------------------------------------
// Health & root (before /api catch-all style routers)
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    service: "SAMA-SUITE API",
    environment: process.env.NODE_ENV || "development",
    databaseUrlConfigured: !!process.env.DATABASE_URL,
    jwtConfigured: !!process.env.JWT_SECRET,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.json({
    success: true,
    service: "SAMA-SUITE Backend",
    company: "Sama Technologies",
    status: "running",
  });
});

// ---------------------------------------------------------------------------
// API — auth first (explicit mount + rate limit), then aggregated /api router
// ---------------------------------------------------------------------------
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api", apiRouter);

// ---------------------------------------------------------------------------
// 404
// ---------------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found",
    path: req.originalUrl,
  });
});

module.exports = app;
