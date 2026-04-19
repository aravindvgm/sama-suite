const { Pool } = require('pg');

let pool;

if (process.env.DATABASE_URL) {
  // ✅ Production (Render)
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  console.log("🚀 Using DATABASE_URL (Production)");
} else {
  // ✅ Local fallback (only for your machine)
  pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'sama_suite',
    user: 'postgres',
    password: 'password',
  });

  console.log("💻 Using LOCAL DB");
}

// Test connection
(async () => {
  try {
    const client = await pool.connect();
    console.log("✅ Database connected successfully");
    client.release();
  } catch (err) {
    console.error("❌ Database connection failed");
    console.error(err.message);
  }
})();

pool.on("error", (err) => {
  console.error("❌ Unexpected DB error", err);
});

module.exports = pool;