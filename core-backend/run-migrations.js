#!/usr/bin/env node

require('dotenv').config();

const fs               = require('fs');
const path             = require('path');
const { execFileSync, execSync } = require('child_process');
const pool             = require('./src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, 'db_migrations');

// PG* env vars for psql — mirror the pool config so both use the same DB.
const pgEnv = {
  ...process.env,
  PGHOST:     process.env.DB_HOST     || 'localhost',
  PGPORT:     process.env.DB_PORT     || '5432',
  PGDATABASE: process.env.DB_NAME     || 'sama_suite',
  PGUSER:     process.env.DB_USER     || 'postgres',
  PGPASSWORD: process.env.DB_PASSWORD || 'password',
};

// Resolve the psql binary: PATH first, then common Windows install locations.
function findPsql() {
  try {
    const cmd = process.platform === 'win32' ? 'where psql' : 'which psql';
    return execSync(cmd, { stdio: 'pipe' }).toString().trim().split('\n')[0].trim();
  } catch { /* not in PATH */ }

  if (process.platform === 'win32') {
    const bases = [
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
    ].filter(Boolean);
    for (const base of bases) {
      const pgDir = path.join(base, 'PostgreSQL');
      if (!fs.existsSync(pgDir)) continue;
      const versions = fs.readdirSync(pgDir).sort().reverse(); // newest first
      for (const ver of versions) {
        const bin = path.join(pgDir, ver, 'bin', 'psql.exe');
        if (fs.existsSync(bin)) return bin;
      }
    }
  }

  throw new Error(
    'psql not found. Add the PostgreSQL bin directory to PATH or install postgresql-client.'
  );
}

// Run a SQL file through psql.  psql sends each statement as a separate
// protocol message, which allows CREATE INDEX CONCURRENTLY to execute outside
// a transaction block.  -v ON_ERROR_STOP=1 causes psql to exit non-zero on
// the first error so execFileSync throws and the migration is not recorded.
//
// findPsql() is called lazily here (not at module load time) so that a missing
// psql binary does not prevent the module from loading or stop regular
// (non-CONCURRENTLY) migrations from running.
function runWithPsql(filePath) {
  const psql = findPsql();
  execFileSync(psql, ['-v', 'ON_ERROR_STOP=1', '-f', filePath], {
    env:   pgEnv,
    stdio: 'inherit',
  });
}

// Arbitrary constant that uniquely identifies sama-suite migration runs.
// Any 32-bit integer works; just must be consistent across all runners.
const MIGRATION_LOCK_ID = 48273645;

async function runMigrations() {
  const client = await pool.connect();

  try {
    // Acquire a session-level advisory lock so only one runner executes at a
    // time.  pg_advisory_lock blocks until the lock is available (no timeout).
    // It is automatically released when this client connection closes, so a
    // crash or SIGKILL cannot leave the lock permanently held.
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

      // -- @no-transaction: migration manages its own BEGIN/COMMIT blocks
      // and/or uses CREATE INDEX CONCURRENTLY.  Delegated to psql so each
      // statement is sent as a separate protocol message.
      const noTransaction = sql.includes('-- @no-transaction');

      try {
        if (noTransaction) {
          runWithPsql(filePath);
          await client.query('INSERT INTO migrations (id) VALUES ($1)', [file]);
        } else {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('INSERT INTO migrations (id) VALUES ($1)', [file]);
          await client.query('COMMIT');
        }
        console.log(`Applied ${file}`);
      } catch (err) {
        if (!noTransaction) await client.query('ROLLBACK');
        console.error(`Failed on ${file}: ${err.message}`);
        throw err;
      }
    }
  } finally {
    // Explicitly release the advisory lock before returning the connection to
    // the pool.  client.release() also releases it (session-level locks are
    // tied to the connection), but being explicit avoids surprises if the pool
    // ever reuses connections without resetting session state.
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
