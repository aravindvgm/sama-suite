#!/usr/bin/env node
'use strict';

/**
 * Seed script — creates a test organization + admin user for development/staging.
 *
 * Run from core-backend root:
 *   node src/scripts/seed.js
 *
 * Safe to re-run: all inserts are idempotent (ON CONFLICT DO NOTHING).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const bcrypt = require('bcryptjs');
const pool   = require('../config/db');

const ORG_NAME   = 'Sama Demo School';
const ORG_CODE   = 'SAMA-DEMO';
const ROLE_KEY   = 'org_admin';
const ROLE_NAME  = 'Org Admin';
const ADMIN_EMAIL    = 'admin@sama.com';
const ADMIN_PASSWORD = 'admin123';
const ADMIN_NAME     = 'Demo Admin';

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── 1. Organization ──────────────────────────────────────────────────────
    const orgResult = await client.query(`
      INSERT INTO organizations (name, code, industry_type)
      VALUES ($1, $2, 'education')
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name, code
    `, [ORG_NAME, ORG_CODE]);

    const org = orgResult.rows[0];
    console.log(`✅ Organization: ${org.name} (${org.id})`);

    // ── 2. Role ──────────────────────────────────────────────────────────────
    const roleResult = await client.query(`
      INSERT INTO roles (organization_id, name, key, is_system_role)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (organization_id, name) DO UPDATE SET key = EXCLUDED.key
      RETURNING id, key
    `, [org.id, ROLE_NAME, ROLE_KEY]);

    const role = roleResult.rows[0];
    console.log(`✅ Role: ${role.key} (${role.id})`);

    // ── 3. User ──────────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);

    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, full_name, organization_id, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT DO NOTHING
      RETURNING id, email
    `, [ADMIN_EMAIL, passwordHash, ADMIN_NAME, org.id]);

    let userId;

    if (userResult.rowCount === 0) {
      // Already exists — fetch id
      const existing = await client.query(
        `SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)`,
        [ADMIN_EMAIL]
      );
      userId = existing.rows[0].id;
      console.log(`ℹ️  User already exists: ${existing.rows[0].email} (${userId})`);
    } else {
      userId = userResult.rows[0].id;
      console.log(`✅ User: ${userResult.rows[0].email} (${userId})`);
    }

    // ── 4. Membership ────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO memberships (user_id, organization_id, role_id, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (user_id, organization_id) DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active'
    `, [userId, org.id, role.id]);

    console.log(`✅ Membership: user ${userId} → org ${org.id} as ${ROLE_KEY}`);

    await client.query('COMMIT');

    console.log('');
    console.log('════════════════════════════════════');
    console.log('Seed complete. Test credentials:');
    console.log(`  Email:    ${ADMIN_EMAIL}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log('════════════════════════════════════');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
