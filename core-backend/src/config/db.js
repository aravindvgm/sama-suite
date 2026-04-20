"use strict";

const { Pool } = require("pg");

const isProduction = process.env.NODE_ENV === "production";

let pool;

/* -------------------------------------------------------------------------- */
/* DATABASE CONFIG                                                            */
/* -------------------------------------------------------------------------- */

const poolConfig = process.env.RENDER
  ? {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  }
  : {
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    database: process.env.DB_NAME || "sama_suite",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "password",
  };

pool = new Pool(poolConfig);

if (process.env.RENDER) {
  console.log("🚀 DB: Using DATABASE_URL (Render)");
} else {
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