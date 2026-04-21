"use strict";

const { Pool } = require("pg");

let connectionString = process.env.DATABASE_URL;
const useConnectionString = !!connectionString;

console.log("📦 DB Mode:", useConnectionString ? "CLOUD" : "LOCAL");

if (useConnectionString && !connectionString.includes("sslmode")) {
  const separator = connectionString.includes("?") ? "&" : "?";
  connectionString = connectionString + `${separator}sslmode=require`;
}

const pool = new Pool(
  useConnectionString
    ? {
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
        database: process.env.DB_NAME || "sama_suite",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "password",
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      }
);

pool.on("connect", () => {
  console.log("✅ PostgreSQL connected");
});

pool.on("error", (err) => {
  console.error("❌ PostgreSQL error:", err.message);
});

module.exports = pool;
