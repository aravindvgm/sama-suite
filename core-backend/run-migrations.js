#!/usr/bin/env node

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const pool = require("./src/config/db");

const MIGRATIONS_DIR = path.join(__dirname, 'db_migrations');

// Unique lock ID (must stay constant across all instances)
const MIGRATION_LOCK_ID = 48273645;

async function runMigrations() {
  const startTime = Date.now();

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.error(`❌ Migrations directory not found: ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    console.log("🔒 Acquiring migration lock...");

    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    console.log("✅ Migration lock acquired");

    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id          TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ DEFAULT now(),
        applied_by  TEXT DEFAULT current_user
      )
    `);

    // Fetch already-applied migrations
    const { rows } = await client.query('SELECT id FROM migrations');
    const applied = new Set(rows.map(r => r.id));

    // Get migration files
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log("⚠️ No migration files found");
      return;
    }

    console.log(`📦 Found ${files.length} migration(s)`);

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭️ Skipping ${file}`);
        continue;
      }

      console.log(`🚀 Running ${file}`);

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        // 🔥 CRITICAL: wrap each migration in transaction
        await client.query('BEGIN');

        await client.query(sql);
        await client.query(
          'INSERT INTO migrations (id) VALUES ($1)',
          [file]
        );

        await client.query('COMMIT');

        console.log(`✅ Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');

        console.error(`❌ Failed on ${file}`);
        console.error(err.message);

        throw err; // stop execution immediately
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`🎉 All migrations completed in ${duration}s`);

  } catch (err) {
    console.error("💥 Migration process failed:", err.message);
    throw err;
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      console.log("🔓 Migration lock released");
    } catch (e) {
      console.warn("⚠️ Failed to release advisory lock");
    }

    client.release();
  }
}

// Export for app startup usage
module.exports = { runMigrations };

// CLI execution
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}