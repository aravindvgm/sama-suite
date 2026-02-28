#!/usr/bin/env node

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const pool = require('./src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'db_migrations');

async function runMigrations() {
  const client = await pool.connect();

  try {
    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id          TEXT        PRIMARY KEY,
        applied_at  TIMESTAMPTZ DEFAULT now(),
        applied_by  TEXT        DEFAULT current_user
      )
    `);

    // Fetch already-applied migration IDs
    const { rows } = await client.query('SELECT id FROM migrations');
    const applied  = new Set(rows.map(r => r.id));

    // Collect and sort SQL files alphabetically
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping ${file}`);
        continue;
      }

      console.log(`Running ${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO migrations (id) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Failed on ${file}: ${err.message}`);
        throw err;
      }
    }
  } finally {
    client.release();
  }

  process.exit(0);
}

runMigrations();
