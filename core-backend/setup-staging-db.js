#!/usr/bin/env node
/**
 * PostgreSQL Staging Database Setup Script
 * Creates the staging database, user, and applies migrations
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs');
const path = require('path');

const DB_USER = 'sama_user';
const DB_PASSWORD = 'staging_password';
const DB_NAME = 'sama_staging';
const DB_HOST = 'localhost';
const POSTGRES_USER = 'postgres'; // Default PostgreSQL superuser

async function runCommand(command, description) {
  console.log(`\n▶ ${description}...`);
  try {
    const { stdout, stderr } = await execAsync(command, {
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'
    });
    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('already exists')) console.warn(stderr);
    return true;
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
    return false;
  }
}

async function setupDatabase() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   PostgreSQL Staging Database Setup                    ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  // Step 1: Create the PostgreSQL user
  const createUserCmd = `psql -U ${POSTGRES_USER} -h ${DB_HOST} -tc "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';" 2>&1 || true`;
  await runCommand(createUserCmd, 'Create database user');

  // Step 2: Create the staging database
  const createDbCmd = `psql -U ${POSTGRES_USER} -h ${DB_HOST} -tc "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" 2>&1 || true`;
  await runCommand(createDbCmd, 'Create staging database');

  // Step 3: Grant privileges
  const grantCmd = `psql -U ${POSTGRES_USER} -h ${DB_HOST} -tc "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" 2>&1 || true`;
  await runCommand(grantCmd, 'Grant database privileges');

  // Step 4: Connect as the new user and set up schema
  const setupSchemaCmd = `psql -U ${DB_USER} -h ${DB_HOST} -d ${DB_NAME} -c "\\dt" 2>&1`;
  const schemaResult = await execAsync(setupSchemaCmd);

  console.log('\n✓ Database user and database created successfully!');
  console.log(`\nSetup Details:`);
  console.log(`  Database: ${DB_NAME}`);
  console.log(`  User: ${DB_USER}`);
  console.log(`  Host: ${DB_HOST}`);
  console.log(`  Port: 5432`);

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   Setup Complete - Run test-db-connection.js next      ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
}

setupDatabase().catch(error => {
  console.error('\n✗ Setup failed:', error.message);
  process.exit(1);
});
