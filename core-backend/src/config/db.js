"use strict";

const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
const useConnectionString = !!connectionString;

// 👇 Controlled debug (safe)
console.log("📦 DB Mode:", useConnectionString ? "CLOUD" : "LOCAL");

const pool = new Pool(
  useConnectionString
    ? {
        connectionString,
        ssl: {
          rejectUnauthorized: false, // required for Render
        },

        // 👇 IMPORTANT for SaaS stability
        max: 10,                // max connections
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT
          ? Number(process.env.DB_PORT)
          : 5432,
        database: process.env.DB_NAME || "sama_suite",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "password",

        // 👇 same tuning locally
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

// 👇 Connection lifecycle logs
pool.on("connect", () => {
  console.log("✅ PostgreSQL connected");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL error:", err.message);
});

module.exports = pool;