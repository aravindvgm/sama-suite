"use strict";

// ---------------------------------------------------------------------------
// Environment (Render injects env vars; do not require .env on cloud)
// ---------------------------------------------------------------------------
if (!process.env.RENDER) {
  require("dotenv").config();
}

// ---------------------------------------------------------------------------
// Global crash guards (log once)
// ---------------------------------------------------------------------------
const GLOBAL_GUARD_KEY = "__SAMA_SUITE_GLOBAL_CRASH_GUARDS__";

if (!global[GLOBAL_GUARD_KEY]) {
  global[GLOBAL_GUARD_KEY] = true;

  process.on("uncaughtException", (err) => {
    console.error("FATAL: uncaughtException");
    console.error(err?.stack || err);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("FATAL: unhandledRejection");
    console.error(reason?.stack || reason);
  });
}

// ---------------------------------------------------------------------------
// Boot diagnostics
// ---------------------------------------------------------------------------
console.log("=================================");
console.log("SAMA-SUITE boot");
console.log("NODE_ENV:", process.env.NODE_ENV || "development");
console.log("RENDER:", !!process.env.RENDER);
console.log("DATABASE_URL set:", !!process.env.DATABASE_URL);
console.log("JWT_SECRET set:", !!process.env.JWT_SECRET);
console.log("=================================");

// ---------------------------------------------------------------------------
// Critical config (fail fast in production / Render)
// ---------------------------------------------------------------------------
const isProdLike =
  process.env.NODE_ENV === "production" || !!process.env.RENDER;

if (isProdLike && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is required in production / Render.");
  process.exit(1);
}

if (!process.env.JWT_SECRET) {
  console.warn("WARN: JWT_SECRET missing — auth tokens will fail.");
}

// ---------------------------------------------------------------------------
// Express application (single source of truth: ./server.js)
// ---------------------------------------------------------------------------
const app = require("./server");

const PORT = Number(process.env.PORT) || 5000;

// ---------------------------------------------------------------------------
// Background migrations (after HTTP server is listening)
// ---------------------------------------------------------------------------
async function runStartupTasks() {
  try {
    const { runMigrations } = require("./run-migrations");
    console.log("Running database migrations...");
    await runMigrations();
    console.log("Migrations completed");
  } catch (err) {
    console.error("Migration FAILED:");
    console.error(err?.stack || err);
    process.exit(1);
  }
}

function start() {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log("=================================");
    console.log(`HTTP listening on 0.0.0.0:${PORT}`);
    console.log("Public checks: GET /health  GET /api/health");
    console.log("Auth: POST /api/auth/register  POST /api/auth/login");
    console.log("=================================");
  });

  server.on("error", (err) => {
    console.error("FATAL: HTTP server error");
    console.error(err?.stack || err);
    process.exit(1);
  });

  setImmediate(() => {
    runStartupTasks();
  });

  const shutdown = () => {
    console.log("Shutdown signal received, closing HTTP server...");
    server.close(() => {
      console.log("HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("Forced shutdown (timeout)");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start();
