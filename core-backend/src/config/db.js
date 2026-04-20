"use strict";

const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";

let pool;

/* -------------------------------------------------------------------------- */
/* DATABASE CONFIG                                                            */
/* -------------------------------------------------------------------------- */

if (process.env.DATABASE_URL) {
  // ✅ Production / Render
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,
  });

  console.log("🚀 DB: Using DATABASE_URL");
} else {
  // ✅ Local development (use .env instead of hardcoding ideally)
  pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    database: process.env.DB_NAME || "sama_suite",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "password",
    ssl: false,
  });

  console.log("💻 DB: Using LOCAL CONFIG");
}

/* -------------------------------------------------------------------------- */
/* CONNECTION TEST                                                            */
/* -------------------------------------------------------------------------- */

(async () => {
  try {
    const client = await pool.connect();
    console.log("✅ Database connected successfully");
    client.release();
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error("👉 Reason:", err.message);
  }
})();

/* -------------------------------------------------------------------------- */
/* ERROR HANDLING                                                             */
/* -------------------------------------------------------------------------- */

pool.on("error", (err) => {
  console.error("❌ Unexpected DB error", err);
});

/* -------------------------------------------------------------------------- */

module.exports = pool;