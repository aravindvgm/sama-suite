#!/usr/bin/env node
/**
 * Automated Test Suite - Financial Integrity Verification
 * Tests each scenario independently for robustness
 */

require('dotenv').config();
const pool = require('./src/config/db');
const { v4: uuid } = require('uuid');
const bcrypt = require('bcrypt');

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('ROLLBACK');
    console.log(`  ✓ PASS: ${name}`);
    passCount++;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {}
    console.log(`  ✗ FAIL: ${name}`);
    console.log(`    Error: ${error.message}`);
    failCount++;
  } finally {
    client.release();
  }
}

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   Automated Test Suite - Financial Integrity Check     ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Setup: Create test org and user
  const client = await pool.connect();
  const testOrgId = uuid();
  const testUserId = uuid();
  const hashedPassword = await bcrypt.hash('test123', 10);

  await client.query(
    `INSERT INTO organizations (id, name, code, industry_type) VALUES ($1, $2, $3, $4)`,
    [testOrgId, 'Test Org', 'TEST-ORG-' + Date.now(), 'SCHOOL']
  );

  await client.query(
    `INSERT INTO users (id, full_name, email, password, role) VALUES ($1, $2, $3, $4, $5)`,
    [testUserId, 'Test User', 'test-' + Date.now() + '@example.com', hashedPassword, 'SUPER_ADMIN']
  );
  client.release();

  console.log('═══ TEST SECTION 1: INVOICE OPERATIONS ═══════════════════\n');

  await test('Create invoice with valid amount', async (client) => {
    const invoiceId = uuid();
    const result = await client.query(
      `INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING total_amount`,
      [invoiceId, testOrgId, uuid(), 'INV-TEST-001', 50000.00, '2026-03-31', 'DRAFT']
    );
    if (parseFloat(result.rows[0].total_amount) !== 50000.00) throw new Error('Amount mismatch');
  });

  console.log('\n═══ TEST SECTION 2: PAYMENT OPERATIONS ═════════════════\n');

  await test('Create payment for invoice', async (client) => {
    const invoiceId = uuid();
    await client.query(
      `INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, testOrgId, uuid(), 'INV-PAY', 50000.00, '2026-03-31', 'DRAFT']
    );

    const result = await client.query(
      `INSERT INTO payments (id, organization_id, invoice_id, amount, payment_method, external_payment_id, status, payment_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING amount`,
      [uuid(), testOrgId, invoiceId, 30000.00, 'UPI', 'EXT-TEST-' + Date.now(), 'PENDING_VERIFICATION', new Date()]
    );
    if (parseFloat(result.rows[0].amount) !== 30000.00) throw new Error('Payment amount mismatch');
  });

  await test('Enforce payment idempotency with unique external_payment_id per org', async (client) => {
    const invoiceId = uuid();
    const extPaymentId = 'IDEMPOTENT-' + uuid();

    await client.query(
      `INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, testOrgId, uuid(), 'INV-IMP', 50000.00, '2026-03-31', 'DRAFT']
    );

    await client.query(
      `INSERT INTO payments (id, organization_id, invoice_id, amount, payment_method, external_payment_id, status, payment_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uuid(), testOrgId, invoiceId, 30000.00, 'UPI', extPaymentId, 'PENDING_VERIFICATION', new Date()]
    );

    try {
      await client.query(
        `INSERT INTO payments (id, organization_id, invoice_id, amount, payment_method, external_payment_id, status, payment_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [uuid(), testOrgId, invoiceId, 10000.00, 'UPI', extPaymentId, 'PENDING_VERIFICATION', new Date()]
      );
      throw new Error('Should have rejected duplicate external_payment_id');
    } catch (err) {
      if (err.message.includes('Should have rejected')) throw err;
    }
  });

  console.log('\n═══ TEST SECTION 3: ADJUSTMENT OPERATIONS ══════════════\n');

  await test('Create REFUND adjustment with payment', async (client) => {
    const invoiceId = uuid();
    const paymentId = uuid();

    await client.query(
      `INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, testOrgId, uuid(), 'INV-ADJ', 50000.00, '2026-03-31', 'DRAFT']
    );

    await client.query(
      `INSERT INTO payments (id, organization_id, invoice_id, amount, payment_method, external_payment_id, status, payment_date, verified_by, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [paymentId, testOrgId, invoiceId, 30000.00, 'UPI', 'EXT-ADJ-' + Date.now(), 'VERIFIED', new Date(), testUserId, new Date()]
    );

    const result = await client.query(
      `INSERT INTO adjustments (id, organization_id, invoice_id, payment_id, type, amount, status, reason, requested_by, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING type`,
      [uuid(), testOrgId, invoiceId, paymentId, 'REFUND', 10000.00, 'PENDING', 'Refund', testUserId, new Date()]
    );
    if (result.rows[0].type !== 'REFUND') throw new Error('Adjustment type mismatch');
  });

  await test('Create WRITE_OFF adjustment without payment', async (client) => {
    const invoiceId = uuid();

    await client.query(
      `INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invoiceId, testOrgId, uuid(), 'INV-WO', 50000.00, '2026-03-31', 'DRAFT']
    );

    const result = await client.query(
      `INSERT INTO adjustments (id, organization_id, invoice_id, payment_id, type, amount, status, reason, requested_by, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING type`,
      [uuid(), testOrgId, invoiceId, null, 'WRITE_OFF', 50000.00, 'PENDING', 'Write-off', testUserId, new Date()]
    );
    if (result.rows[0].type !== 'WRITE_OFF') throw new Error('Write-off failed');
  });

  console.log('\n═══ TEST SECTION 4: FOREIGN KEY CONSTRAINTS ════════════\n');

  await test('Reject invoice with non-existent organization', async (client) => {
    try {
      await client.query(
        `INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [uuid(), uuid(), uuid(), 'INV-BAD', 10000.00, '2026-03-31', 'DRAFT']
      );
      throw new Error('Should have rejected invalid organization');
    } catch (err) {
      if (err.message.includes('Should have rejected')) throw err;
    }
  });

  console.log('\n═══ TEST SECTION 5: AUDIT TRAIL ═══════════════════════\n');

  await test('Create and verify audit log', async (client) => {
    const auditId = uuid();
    const result = await client.query(
      `INSERT INTO audit_logs (id, organization_id, entity_type, entity_id, action, changed_by, user_role, changed_at, previous_state, new_state, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING action`,
      [
        auditId, testOrgId, 'PAYMENT', uuid(), 'VERIFY', testUserId, 'SUPER_ADMIN', new Date(),
        JSON.stringify({ status: 'PENDING' }),
        JSON.stringify({ status: 'VERIFIED' }),
        'Test audit'
      ]
    );
    if (result.rows[0].action !== 'VERIFY') throw new Error('Audit log failed');
  });

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║          Test Suite Results Summary                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log(`Total Tests: ${passCount + failCount}`);
  console.log(`Passed: ${passCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Success Rate: ${Math.round((passCount / (passCount + failCount)) * 100)}%\n`);

  if (failCount === 0) {
    console.log('✓ All tests passed! Financial integrity verified.\n');
    process.exit(0);
  } else {
    console.log(`✗ ${failCount} test(s) failed.\n`);
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('\n✗ Test suite error:', error.message);
  process.exit(1);
});
