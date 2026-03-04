// SAMA-SUITE backend entry point

// dotenv MUST be the very first line — before any require() that reads process.env
require("dotenv").config();

// ── Startup diagnostics ───────────────────────────────────────────────────────
// Printed before modules load so misconfiguration is visible immediately.

console.log("DB_HOST:", process.env.DB_HOST);
console.log("DB_NAME:", process.env.DB_NAME);
console.log("JWT_SECRET loaded:", !!process.env.JWT_SECRET);

// ── Critical environment validation ──────────────────────────────────────────
// Stop the process before binding the port — a server with no JWT_SECRET
// would accept connections but fail every auth operation.

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is missing in environment variables");
  process.exit(1);
}

// ── App bootstrap ─────────────────────────────────────────────────────────────

const app = require("./server");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("=================================");
  console.log("SAMA-SUITE Backend Started");
  console.log("Company: Sama Technologies");
  console.log("Environment:", process.env.NODE_ENV);
  console.log("Port:", PORT);
  console.log("=================================");
});
