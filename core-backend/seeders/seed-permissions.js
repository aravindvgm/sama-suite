'use strict';

require('dotenv').config();

const pool = require('../src/config/db');

const PERMISSIONS = [
  { module: 'students', action: 'create' },
  { module: 'students', action: 'read' },
  { module: 'students', action: 'update' },
  { module: 'students', action: 'delete' },

  { module: 'staff', action: 'create' },
  { module: 'staff', action: 'read' },
  { module: 'staff', action: 'update' },
  { module: 'staff', action: 'delete' },

  { module: 'auth', action: 'login' },
  { module: 'auth', action: 'logout' },
];

async function seedPermissions() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const { module, action } of PERMISSIONS) {
      await client.query(
        `INSERT INTO permissions (id, module, action)
         VALUES (gen_random_uuid(), $1, $2)
         ON CONFLICT (module, action) DO NOTHING`,
        [module, action]
      );
    }

    await client.query('COMMIT');

    console.log(`✅ Permissions seeded successfully (${PERMISSIONS.length} entries processed).`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to seed permissions. Transaction rolled back.');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedPermissions().then(() => process.exit(0));
