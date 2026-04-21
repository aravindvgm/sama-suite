"use strict";

// ----------------------------------------------------
// Load .env ONLY for local development
// ----------------------------------------------------
if (!process.env.RENDER) {
  require("dotenv").config();
}

// ----------------------------------------------------
// Global crash guards
// ----------------------------------------------------
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

// ----------------------------------------------------
// Startup logs (clean + useful)
// ----------------------------------------------------
console.log("=================================");
console.log("🚀 SAMA-SUITE Booting...");
console.log("Environment:", process.env.NODE_ENV || "development");
console.log("Mode:", process.env.DATABASE_URL ? "CLOUD DB" : "LOCAL DB");
console.log("JWT_SECRET loaded:", !!process.env.JWT_SECRET);
console.log("=================================");

// ----------------------------------------------------
// Validate critical env
// ----------------------------------------------------
if (!process.env.JWT_SECRET) {
  console.error("❌ JWT_SECRET is missing. Application may fail.");
}

// ----------------------------------------------------
// Load server
// ----------------------------------------------------
const app = require("./server");

// 👉 Always trust Render PORT
const PORT = process.env.PORT || 5000;

// ----------------------------------------------------
// Background migrations
// ----------------------------------------------------
async function runStartupTasks() {
  try {
    const { runMigrations } = require("./run-migrations");

    console.log("📦 Running database migrations...");
    await runMigrations();
    console.log("✅ Migrations completed");
  } catch (err) {
    console.error("❌ Migration FAILED:");
    console.error(err?.stack || err);

    // 👉 In SaaS, better to crash than run broken DB
    process.exit(1);
  }
}

// ----------------------------------------------------
// Start server
// ----------------------------------------------------
function start() {
  const server = app.listen(PORT, () => {
    console.log("=================================");
    console.log(`✅ Server running on port ${PORT}`);
    console.log("=================================");
  });

  server.on("error", (err) => {
    console.error("FATAL: server error");
    console.error(err?.stack || err);
    process.exit(1);
  });

  // Run migrations AFTER server starts
  setImmediate(() => {
    runStartupTasks();
  });

  // ----------------------------------------------------
  // Graceful shutdown (VERY IMPORTANT)
  // ----------------------------------------------------
  const shutdown = () => {
    console.log("🛑 Shutting down server...");

    server.close(() => {
      console.log("✅ Server closed");
      process.exit(0);
    });

    // force exit after timeout
    setTimeout(() => {
      console.error("❌ Forced shutdown");
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start();