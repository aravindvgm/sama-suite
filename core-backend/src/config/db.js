const { Pool } = require("pg");

// ----------------------------------------------------
// Validate required environment variables (no fallbacks)
// ----------------------------------------------------
const REQUIRED_VARS = ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD"];

for (const key of REQUIRED_VARS) {
  if (!process.env[key]) {
    console.warn(`⚠️ Missing env: ${key}`);
  }
}

// ----------------------------------------------------
// Create DB pool (Render-safe config)
// ----------------------------------------------------
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  min: 2,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,

  // Render Postgres requires SSL
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
});

// ----------------------------------------------------
// Log connection success (non-blocking)
// ----------------------------------------------------
(async () => {
  try {
    const client = await pool.connect();

    console.log("✅ Database connected");
    console.log("👉 DB_HOST:", process.env.DB_HOST);
    console.log("👉 DB_NAME:", process.env.DB_NAME);
    console.log("👉 DB_USER:", process.env.DB_USER);

    client.release();
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err?.message || err);

    // ❌ DO NOT exit (keeps Render alive for debugging)
  }
})();

// ----------------------------------------------------
// Handle pool errors
// ----------------------------------------------------
pool.on("error", (err) => {
  console.error("❌ Unexpected database error:", err?.message || err);
});

// ----------------------------------------------------
// Graceful shutdown
// ----------------------------------------------------
process.on("SIGINT", async () => {
  console.log("Closing database pool...");
  await pool.end();
  process.exit(0);
});

module.exports = pool;