const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === "production";

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

  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false,
});


// Safe DB check (no crash)
(async () => {
  try {
    const client = await pool.connect();
    console.log("✅ Database connected");
    console.log("👉 DB Name:", process.env.DB_NAME);
    console.log("👉 DB User:", process.env.DB_USER);
    client.release();
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err.message); // cleaner log
  }
})();

pool.on("error", (err) => {
  console.error("❌ Unexpected database error", err);
});

module.exports = pool;