#!/usr/bin/env node
/**
 * Database Seed Script
 * Creates realistic test data for validation and testing
 * Includes organizations, users, invoices, and invoice items
 */

require('dotenv').config();
const pool = require('./src/config/db');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcrypt');

const testData = {
  organizations: [
    {
      id: uuid(),
      name: 'ABC School',
      code: 'ABC-SCHOOL',
      industry_type: 'SCHOOL',
      upi_id: 'abcschool@upi'
    },
    {
      id: uuid(),
      name: 'Maple Apartments',
      code: 'MAPLE-APT',
      industry_type: 'APARTMENT',
      upi_id: 'maplecomplx@upi'
    },
    {
      id: uuid(),
      name: 'FitZone Gym',
      code: 'FITZONE',
      industry_type: 'GYM',
      upi_id: 'fitzone@upi'
    }
  ],
  users: [
    {
      id: uuid(),
      full_name: 'Admin User',
      email: 'admin@test.com',
      password: 'Admin@123', // Will be hashed
      role: 'SUPER_ADMIN'
    },
    {
      id: uuid(),
      full_name: 'School Manager',
      email: 'school@test.com',
      password: 'SchoolPass@123',
      role: 'USER'
    },
    {
      id: uuid(),
      full_name: 'Apartment Manager',
      email: 'apartment@test.com',
      password: 'ApartmentPass@123',
      role: 'USER'
    },
    {
      id: uuid(),
      full_name: 'Gym Manager',
      email: 'gym@test.com',
      password: 'GymPass@123',
      role: 'USER'
    }
  ]
};

// Store org/user IDs for creating relationships
let orgIds = [];
let userIds = [];

async function seedDatabase() {
  const client = await pool.connect();

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   Database Seed Script - Creating Test Data           ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    await client.query('BEGIN');

    // Step 1: Seed Organizations
    console.log('▶ Creating organizations...');
    for (const org of testData.organizations) {
      await client.query(
        `INSERT INTO organizations (id, name, code, industry_type, upi_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [org.id, org.name, org.code, org.industry_type, org.upi_id]
      );
      orgIds.push(org.id);
      console.log(`  ✓ ${org.name} (${org.code})`);
    }

    // Step 2: Seed Users
    console.log('\n▶ Creating users...');
    for (const user of testData.users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await client.query(
        `INSERT INTO users (id, full_name, email, password, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.full_name, user.email, hashedPassword, user.role]
      );
      userIds.push(user.id);
      console.log(`  ✓ ${user.full_name} (${user.email})`);
    }

    // Step 3: Create Organization-User Relationships
    console.log('\n▶ Creating organization-user relationships...');
    const adminUserId = userIds[0]; // Admin user
    const schoolManagerId = userIds[1];
    const apartmentManagerId = userIds[2];
    const gymManagerId = userIds[3];

    const relationships = [
      { org_id: orgIds[0], user_id: adminUserId, org_role: 'ORG_ADMIN', is_owner: true },
      { org_id: orgIds[0], user_id: schoolManagerId, org_role: 'ORG_MANAGER', is_owner: false },
      { org_id: orgIds[1], org_role: 'ORG_ADMIN', user_id: adminUserId, is_owner: true },
      { org_id: orgIds[1], user_id: apartmentManagerId, org_role: 'ORG_MANAGER', is_owner: false },
      { org_id: orgIds[2], user_id: adminUserId, org_role: 'ORG_ADMIN', is_owner: true },
      { org_id: orgIds[2], user_id: gymManagerId, org_role: 'ORG_MANAGER', is_owner: false }
    ];

    for (const rel of relationships) {
      await client.query(
        `INSERT INTO organization_users (organization_id, user_id, org_role, is_owner)
         VALUES ($1, $2, $3, $4)`,
        [rel.org_id, rel.user_id, rel.org_role, rel.is_owner]
      );
      const org = testData.organizations.find(o => o.id === rel.org_id);
      const user = testData.users.find(u => u.id === rel.user_id);
      console.log(`  ✓ ${user.full_name} → ${org.name} (${rel.org_role})`);
    }

    // Step 4: Create Sample Invoices
    console.log('\n▶ Creating sample invoices...');
    const invoices = [
      {
        org_index: 0,
        person_id: uuid(),
        invoice_number: 'INV-ABC-001',
        total_amount: 15000.00,
        due_date: '2026-03-15',
        status: 'SENT',
        notes: 'Monthly tuition - Class A'
      },
      {
        org_index: 0,
        person_id: uuid(),
        invoice_number: 'INV-ABC-002',
        total_amount: 12500.00,
        due_date: '2026-03-20',
        status: 'PENDING',
        notes: 'Monthly tuition - Class B'
      },
      {
        org_index: 1,
        person_id: uuid(),
        invoice_number: 'INV-MAP-001',
        total_amount: 50000.00,
        due_date: '2026-02-28',
        status: 'PARTIAL',
        notes: 'Apartment maintenance fees - Block A'
      },
      {
        org_index: 1,
        person_id: uuid(),
        invoice_number: 'INV-MAP-002',
        total_amount: 45000.00,
        due_date: '2026-03-31',
        status: 'PENDING',
        notes: 'Apartment maintenance fees - Block B'
      },
      {
        org_index: 2,
        person_id: uuid(),
        invoice_number: 'INV-FIT-001',
        total_amount: 8000.00,
        due_date: '2026-02-20',
        status: 'PAID',
        notes: 'Monthly membership - Premium'
      },
      {
        org_index: 2,
        person_id: uuid(),
        invoice_number: 'INV-FIT-002',
        total_amount: 5000.00,
        due_date: '2026-03-15',
        status: 'SENT',
        notes: 'Monthly membership - Standard'
      }
    ];

    const createdInvoices = [];
    for (const inv of invoices) {
      const invoiceId = uuid();
      await client.query(
        `INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [invoiceId, orgIds[inv.org_index], inv.person_id, inv.invoice_number, inv.total_amount, inv.due_date, inv.status, inv.notes]
      );
      createdInvoices.push({ id: invoiceId, ...inv });
      console.log(`  ✓ ${inv.invoice_number} - ${inv.total_amount} (${inv.status})`);
    }

    // Step 5: Create Invoice Items
    console.log('\n▶ Creating invoice items...');
    for (const invoice of createdInvoices) {
      const itemCount = Math.floor(Math.random() * 3) + 1; // 1-3 items per invoice

      for (let i = 0; i < itemCount; i++) {
        const quantity = Math.floor(Math.random() * 5) + 1;
        const unitPrice = invoice.total_amount / itemCount / quantity;

        await client.query(
          `INSERT INTO invoice_items (id, organization_id, invoice_id, item_name, quantity, unit_price, total_amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [uuid(), orgIds[invoice.org_index], invoice.id, `Service Item ${i + 1}`, quantity, unitPrice, quantity * unitPrice]
        );
      }
      console.log(`  ✓ Items created for ${invoice.invoice_number}`);
    }

    await client.query('COMMIT');

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   ✓ Seeding Complete                                  ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    console.log('Created Summary:');
    console.log(`  • ${testData.organizations.length} Organizations`);
    console.log(`  • ${testData.users.length} Users`);
    console.log(`  • ${relationships.length} Organization-User assignments`);
    console.log(`  • ${createdInvoices.length} Invoices`);
    console.log('\nTest Credentials:');
    console.log('  Admin:     admin@test.com / Admin@123');
    console.log('  School:    school@test.com / SchoolPass@123');
    console.log('  Apartment: apartment@test.com / ApartmentPass@123');
    console.log('  Gym:       gym@test.com / GymPass@123\n');

    process.exit(0);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n✗ Seeding failed:', error.message);
    console.error('\nError Details:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedDatabase();
