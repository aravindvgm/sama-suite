// SAMA-SUITE backend entry point

// dotenv MUST be first
require("dotenv").config();

// ----------------------------------------------------
// Global crash guards (Render-friendly logging)
// ----------------------------------------------------

const GLOBAL_GUARD_KEY = "__SAMA_SUITE_GLOBAL_CRASH_GUARDS__";
if (!global[GLOBAL_GUARD_KEY]) {
  global[GLOBAL_GUARD_KEY] = true;

  process.on("uncaughtException", (err) => {
    console.error("FATAL: uncaughtException");
    console.error(err?.stack || err);
    // Intentionally do not exit; keep instance alive for Render log visibility.
  });

  process.on("unhandledRejection", (reason) => {
    console.error("FATAL: unhandledRejection");
    console.error(reason?.stack || reason);
    // Intentionally do not exit; keep instance alive for Render log visibility.
  });

  process.on("exit", (code) => {
    console.error(`PROCESS EXIT: code=${code}`);
  });

  process.on("SIGTERM", () => {
    console.warn("Received SIGTERM. Process will exit when event loop drains.");
  });

  process.on("SIGINT", () => {
    console.warn("Received SIGINT. Process will exit when event loop drains.");
  });
}

console.log("=================================");
console.log("SAMA-SUITE Booting...");
console.log("Company: Sama Technologies");
console.log("Environment:", process.env.NODE_ENV);
console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_NAME:", process.env.DB_NAME);
console.log("JWT_SECRET loaded:", !!process.env.JWT_SECRET);
console.log("=================================");


// ----------------------------------------------------
// Validate critical environment variables
// ----------------------------------------------------

if (!process.env.JWT_SECRET) {
  // Do not crash the instance; keep server up for Render debugging.
  console.error("WARN: JWT_SECRET missing (auth will fail until configured).");
}


// ----------------------------------------------------
// Load server
// ----------------------------------------------------

const app = require("./server");
const PORT = process.env.PORT || 3000;


// ----------------------------------------------------
// Optional migrations
// ----------------------------------------------------

async function runStartupTasks() {

  try {

    const { runMigrations } = require("./run-migrations");

    console.log("Running database migrations...");
    await runMigrations();
    console.log("Migrations complete.");

  } catch (err) {

    console.warn("Migration skipped or failed:", err?.message || err);

  }

}


// ----------------------------------------------------
// Start server
// ----------------------------------------------------

function start() {
  // Server must start FIRST (Render fast boot).
  const server = app.listen(PORT, () => {
    console.log("=================================");
    console.log("SAMA-SUITE Backend Started");
    console.log("Port:", PORT);
    console.log("=================================");
  });

  server.on("error", (err) => {
    console.error("FATAL: server listen error");
    console.error(err?.stack || err);
  });

  // Migrations must run in background and never crash startup.
  setImmediate(() => {
    runStartupTasks().catch((err) => {
      console.warn("Startup tasks failed:", err?.message || err);
    });
  });
}


try {
  start();
} catch (err) {
  console.error("FATAL: Startup failure:", err?.message || err);
  console.error(err?.stack || err);
  // Do not exit; keep process alive so Render logs remain visible.
}