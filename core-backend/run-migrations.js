#!/usr/bin/env node

require('dotenv').config();

const fs               = require('fs');
const path             = require('path');
const pool = require("./src/config/db");

const MIGRATIONS_DIR = path.join(__dirname, 'db_migrations');

// Arbitrary constant that uniquely identifies sama-suite migration runs.
// Any 32-bit integer works; just must be consistent across all runners.
const MIGRATION_LOCK_ID = 48273645;

async function runMigrations() {
  const client = await pool.connect();
  try {
    // Acquire a session-level advisory lock so only one runner executes at a
    // time.  pg_advisory_lock blocks until the lock is available (no timeout).
    // It is automatically released when the session ends, so a crash or
    // SIGKILL cannot leave the lock permanently held.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

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
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql      = fs.readFileSync(filePath, 'utf-8');

      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (id) VALUES ($1)', [file]);
        console.log(`Applied ${file}`);
      } catch (err) {
        console.error(`Failed on ${file}: ${err.message}`);
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }

}

// ── Module export (used by index.js for auto-migration on startup) ────────────

module.exports = { runMigrations };

// ── Standalone entry point ────────────────────────────────────────────────────

if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
