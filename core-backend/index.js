// ----------------------------------------------------
// Load .env ONLY for local development (NEVER in Render)
// ----------------------------------------------------
if (!process.env.RENDER) {
  require("dotenv").config();
}

// ----------------------------------------------------
// Global crash guards (Render-friendly logging)
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

  process.on("exit", (code) => {
    console.error(`PROCESS EXIT: code=${code}`);
  });

  process.on("SIGTERM", () => {
    console.warn("Received SIGTERM");
  });

  process.on("SIGINT", () => {
    console.warn("Received SIGINT");
  });
}

// ----------------------------------------------------
// Startup logs (VERY IMPORTANT for debugging)
// ----------------------------------------------------
console.log("=================================");
console.log("SAMA-SUITE Booting...");
console.log("Environment:", process.env.NODE_ENV);
console.log("RENDER:", process.env.RENDER);
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_PORT:", process.env.DB_PORT);
console.log("DB_NAME:", process.env.DB_NAME);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_PASSWORD loaded:", !!process.env.DB_PASSWORD);
console.log("JWT_SECRET loaded:", !!process.env.JWT_SECRET);
console.log("=================================");

// ----------------------------------------------------
// Validate critical env
// ----------------------------------------------------
if (!process.env.JWT_SECRET) {
  console.error("WARN: JWT_SECRET missing");
}

// ----------------------------------------------------
// Load server
// ----------------------------------------------------
const app = require("./server");
// Render provides PORT via env. Locally we always bind to 5000 to avoid
// accidentally inheriting a production-oriented PORT from .env.
const PORT = process.env.RENDER ? (process.env.PORT || 5000) : 5000;

// ----------------------------------------------------
// Background migrations (non-blocking)
// ----------------------------------------------------
async function runStartupTasks() {
  try {
    const { runMigrations } = require("./run-migrations");
    console.log("Running database migrations...");
    await runMigrations();
    console.log("Migrations complete.");
  } catch (err) {
    console.warn("Migration skipped:", err?.message || err);
  }
}

// ----------------------------------------------------
// Start server FIRST (important)
// ----------------------------------------------------
function start() {
  const server = app.listen(PORT, () => {
    console.log("=================================");
    console.log(`Server running on port ${PORT}`);
    console.log("=================================");
  });

  server.on("error", (err) => {
    console.error("FATAL: server error");
    console.error(err?.stack || err);
  });

  // Run migrations AFTER server starts
  setImmediate(() => {
    runStartupTasks().catch((err) => {
      console.warn("Startup tasks failed:", err?.message || err);
    });
  });
}

start();