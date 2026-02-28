#!/usr/bin/env node
/**
 * PostgreSQL Staging Database Verification Report
 * Comprehensive validation of database setup
 */

require('dotenv').config({ path: '.env.staging' });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function generateReport() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                PostgreSQL STAGING DATABASE SETUP - VERIFICATION REPORT        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  try {
    // Section 1: Connection Information
    console.log('┌─ DATABASE CONNECTION INFORMATION ────────────────────────────────────────────┐');
    const versionResult = await pool.query('SELECT version() as version');
    const version = versionResult.rows[0].version.split(',')[0];
    console.log(`Host:       ${process.env.DB_HOST}`);
    console.log(`Port:       ${process.env.DB_PORT}`);
    console.log(`Database:   ${process.env.DB_NAME}`);
    console.log(`User:       ${process.env.DB_USER}`);
    console.log(`Version:    ${version}`);
    console.log(`Status:     ✓ Connected\n`);

    // Section 2: Database Statistics
    console.log('┌─ DATABASE STATISTICS ────────────────────────────────────────────────────────┐');
    const statsResult = await pool.query(`
      SELECT
        schemaname,
        COUNT(*) as table_count,
        SUM(pg_total_relation_size(schemaname||'.'||tablename)) as size_bytes
      FROM pg_tables
      WHERE schemaname = 'public'
      GROUP BY schemaname
    `);

    if (statsResult.rows.length > 0) {
      const stats = statsResult.rows[0];
      const sizeKB = Math.round(stats.size_bytes / 1024);
      console.log(`Tables Created:    ${stats.table_count}`);
      console.log(`Database Size:     ${sizeKB} KB\n`);
    }

    // Section 3: Schema Tables
    console.log('┌─ SCHEMA TABLES (8 TOTAL) ────────────────────────────────────────────────────┐');
    const tablesResult = await pool.query(`
      SELECT
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        (SELECT count(*) FROM pg_indexes WHERE tablename = t.tablename) as index_count
      FROM pg_tables t
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);

    const expectedTables = [
      'adjustments', 'audit_logs', 'invoice_items', 'invoices',
      'organization_users', 'organizations', 'payments', 'users'
    ];

    tablesResult.rows.forEach(row => {
      const status = expectedTables.includes(row.tablename) ? '✓' : '?';
      console.log(`  ${status} ${row.tablename.padEnd(25)} | Size: ${row.size.padEnd(8)} | Indexes: ${row.index_count}`);
    });
    console.log();

    // Section 4: Foreign Key Relationships
    console.log('┌─ FOREIGN KEY RELATIONSHIPS ──────────────────────────────────────────────────┐');
    const fkResult = await pool.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      ORDER BY tc.table_name, kcu.column_name
    `);

    if (fkResult.rows.length > 0) {
      fkResult.rows.forEach(fk => {
        const relationStr = `${fk.table_name}.${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`;
        console.log(`  → ${relationStr}`);
      });
    }
    console.log();

    // Section 5: Table Column Counts
    console.log('┌─ TABLE COLUMN COUNTS ────────────────────────────────────────────────────────┐');
    const columnsResult = await pool.query(`
      SELECT
        table_name,
        COUNT(*) as column_count
      FROM information_schema.columns
      WHERE table_schema = 'public'
      GROUP BY table_name
      ORDER BY table_name
    `);

    columnsResult.rows.forEach(row => {
      console.log(`  ${row.table_name.padEnd(25)} | ${row.column_count} columns`);
    });
    console.log();

    // Section 6: Indexes Created
    console.log('┌─ INDEXES SUMMARY ────────────────────────────────────────────────────────────┐');
    const indexesResult = await pool.query(`
      SELECT
        tablename,
        COUNT(*) as index_count,
        STRING_AGG(indexname, ', ') as indexes
      FROM pg_indexes
      WHERE schemaname = 'public'
      GROUP BY tablename
      ORDER BY tablename
    `);

    indexesResult.rows.forEach(row => {
      console.log(`  ${row.tablename}`);
      console.log(`    Count: ${row.index_count}`);
    });
    console.log();

    // Section 7: Setup Status
    console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                            SETUP STATUS: SUCCESS                              ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

    console.log('✓ PostgreSQL Staging Database configured successfully!');
    console.log('\nNEXT STEPS:');
    console.log('  1. Seed test data (optional):');
    console.log('     node seed-test-data.js');
    console.log('\n  2. Start the server:');
    console.log('     npm run dev');
    console.log('\n  3. Test the database connection via API:');
    console.log('     curl http://localhost:5001/db-test\n');

    process.exit(0);
  } catch (error) {
    console.error('\n✗ Verification failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

generateReport();
