const { Pool } = require('pg');

const pool = new Pool({

  host: process.env.DB_HOST || 'localhost',

  port: process.env.DB_PORT
    ? Number(process.env.DB_PORT)
    : 5432,

  database: process.env.DB_NAME || 'sama_suite',

  user: process.env.DB_USER || 'postgres',

  password: process.env.DB_PASSWORD || 'password',

  min: 5,

  max: 20,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 5000,

  ssl:
    process.env.DB_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,

});


// Test DB connection

(async () => {

  try {

    const client = await pool.connect();

    console.log("✅ Database connected");

    console.log("👉 DB Name:", process.env.DB_NAME);

    console.log("👉 DB User:", process.env.DB_USER);

    client.release();

  } catch (err) {

    console.error("❌ Database connection failed");

    console.error(err);

    process.exit(1);

  }

})();


pool.on("error", (err) => {

  console.error("❌ Unexpected database error", err);

});


process.on("SIGINT", async () => {

  console.log("Closing database pool...");

  await pool.end();

  process.exit(0);

});

module.exports = pool;