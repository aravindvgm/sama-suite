#!/usr/bin/env node
/**
 * PostgreSQL Staging Database Connection Test
 * Tests the connection to the PostgreSQL staging database
 */

require('dotenv').config({ path: '.env.staging' });
const pool = require("./src/config/db");

async function testConnection() {
  console.log('\n=== PostgreSQL Staging Database Connection Test ===\n');
  console.log('Configuration:');
  console.log(`  Host: ${process.env.DB_HOST}`);
  console.log(`  Port: ${process.env.DB_PORT}`);
  console.log(`  Database: ${process.env.DB_NAME}`);
  console.log(`  User: ${process.env.DB_USER}`);
  console.log(`  Connection URL: ${process.env.DATABASE_URL.replace(/:.*@/, ':****@')}\n`);

  try {
    console.log('Testing connection...');
    const result = await pool.query('SELECT NOW() as current_timestamp, version() as db_version');

    console.log('✓ Connection successful!\n');
    console.log('Server Information:');
    console.log(`  Current Timestamp: ${result.rows[0].current_timestamp}`);
    console.log(`  PostgreSQL Version: ${result.rows[0].db_version.split(',')[0]}\n`);

    // Check database and user
    const dbCheckResult = await pool.query(`
      SELECT datname as database, usename as owner
      FROM pg_database
      JOIN pg_user ON pg_database.datdba = pg_user.usesysid
      WHERE datname = $1
    `, [process.env.DB_NAME]);

    if (dbCheckResult.rows.length > 0) {
      console.log('Database Information:');
      console.log(`  Database Name: ${dbCheckResult.rows[0].database}`);
      console.log(`  Owner: ${dbCheckResult.rows[0].owner}\n`);
    }

    // Check tables
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('Database Tables:');
    if (tablesResult.rows.length > 0) {
      tablesResult.rows.forEach(row => {
        console.log(`  - ${row.table_name}`);
      });
    } else {
      console.log('  (No tables found - database appears to be empty)');
    }
    console.log('\n=== Connection Test Complete ===\n');
    process.exit(0);
  } catch (error) {
    console.error('✗ Connection failed!\n');
    console.error('Error Details:');
    console.error(`  Code: ${error.code}`);
    console.error(`  Message: ${error.message}\n`);

    if (error.code === 'ECONNREFUSED') {
      console.error('Troubleshooting Tips:');
      console.error('  1. Ensure PostgreSQL is running on the specified host/port');
      console.error('  2. Verify the database exists: CREATE DATABASE sama_staging;');
      console.error('  3. Verify the user exists: CREATE USER sama_user WITH PASSWORD \'staging_password\';');
      console.error('  4. Grant privileges: GRANT ALL PRIVILEGES ON DATABASE sama_staging TO sama_user;\n');
    } else if (error.code === '28P01') {
      console.error('Troubleshooting: Invalid password or user authentication failed\n');
    } else if (error.code === '3D000') {
      console.error('Troubleshooting: Database does not exist\n');
    }

    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
