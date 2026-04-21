"use strict";

const { Pool } = require("pg");

const isProduction = !!process.env.DATABASE_URL;

const pool = new Pool(
  isProduction
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {
        host: process.env.DB_HOST || "localhost",
        port: process.env.DB_PORT
          ? Number(process.env.DB_PORT)
          : 5432,
        database: process.env.DB_NAME || "sama_suite",
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "password",
      }
);

module.exports = pool;