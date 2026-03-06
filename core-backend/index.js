// SAMA-SUITE backend entry point

// dotenv MUST be first
require("dotenv").config();

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
  console.error("FATAL: JWT_SECRET missing.");
  process.exit(1);
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

    console.warn("Migration skipped or failed:", err.message);

  }

}


// ----------------------------------------------------
// Start server
// ----------------------------------------------------

async function start() {

  await runStartupTasks();

  app.listen(PORT, () => {

    console.log("=================================");
    console.log("SAMA-SUITE Backend Started");
    console.log("Port:", PORT);
    console.log("=================================");

  });

}


start().catch((err) => {

  console.error("FATAL: Startup failure:", err.message);
  process.exit(1);

});