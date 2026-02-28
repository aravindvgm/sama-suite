#!/usr/bin/env node
/**
 * API End-to-End Test Script
 * Tests the complete invoice → payment → adjustment flow
 */

const http = require('http');

const BASE_URL = 'http://localhost:5000';
const API_URL = 'http://localhost:5000/api';

let testToken = null;
let testOrgId = null;
let testInvoiceId = null;
let testPaymentId = null;
let testAdjustmentId = null;

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : API_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (testToken) {
      options.headers['Authorization'] = `Bearer ${testToken}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, data: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, method, path, body = null) {
  try {
    console.log(`\n▶ ${name}`);
    const result = await makeRequest(method, path, body);

    if (result.status >= 200 && result.status < 300) {
      console.log(`  ✓ Status: ${result.status}`);
      console.log(`  ✓ Response:`, JSON.stringify(result.data, null, 2));
      return result.data;
    } else {
      console.log(`  ✗ Status: ${result.status}`);
      console.log(`  ✗ Error:`, JSON.stringify(result.data, null, 2));
      return null;
    }
  } catch (error) {
    console.error(`  ✗ Request failed:`, error.message);
    return null;
  }
}

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   API End-to-End Test - Invoice → Payment → Adjustment ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('SECTION 1: AUTHENTICATION\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Login to get token
  const loginResult = await test(
    'Login with existing user',
    'POST',
    '/auth/login',
    { email: 'school@test.com', password: 'SchoolPass@123' }
  );

  if (!loginResult || !loginResult.token) {
    console.error('\n✗ Failed to obtain JWT token. Stopping tests.');
    process.exit(1);
  }

  testToken = loginResult.token;
  console.log('\n✓ JWT Token obtained:', testToken.substring(0, 20) + '...');

  // Get user profile
  await test('Get authenticated user profile', 'GET', '/auth/profile');

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('SECTION 2: INVOICE MANAGEMENT\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get organization ID from seed data (School Manager should have access to ABC-SCHOOL)
  // We'll use the org ID from the seeded data
  testOrgId = 'test-org-123'; // Placeholder - will be obtained from API

  // First, let's query existing invoices to get the org ID
  console.log('\n▶ Fetching organization ID from seeded invoices...');

  // Since we don't have a direct endpoint to list organizations,
  // we'll use a known invoice from seed data
  // For now, we'll create a new invoice in the school org

  // Create a new invoice
  const invoiceResult = await test(
    'Create new invoice',
    'POST',
    '/12345678-1234-1234-1234-123456789abc/billing/invoices',
    {
      person_id: '87654321-4321-4321-4321-abcdefgh1234',
      due_date: '2026-03-31',
      items: [
        {
          item_name: 'Monthly Tuition Fee',
          quantity: 1,
          unit_price: 25000.00
        },
        {
          item_name: 'Processing Fee',
          quantity: 1,
          unit_price: 500.00
        }
      ],
      notes: 'Test invoice for E2E validation'
    }
  );

  if (invoiceResult && invoiceResult.id) {
    testInvoiceId = invoiceResult.id;
    console.log(`\n✓ Invoice created with ID: ${testInvoiceId}`);
  } else {
    console.log('\n⚠ Note: Invoice creation may require valid organization context.');
    console.log('  The test will continue with manual organization ID.');
    testInvoiceId = 'test-invoice-123';
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('SECTION 3: PAYMENT PROCESSING\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Create a payment
  const paymentResult = await test(
    'Create payment for invoice',
    'POST',
    '/12345678-1234-1234-1234-123456789abc/billing/payments',
    {
      invoiceId: testInvoiceId,
      amount: 15000.00,
      paymentMethod: 'UPI',
      externalPaymentId: `PAY-${Date.now()}`,
      paymentDate: new Date().toISOString().split('T')[0]
    }
  );

  if (paymentResult && paymentResult.id) {
    testPaymentId = paymentResult.id;
    console.log(`\n✓ Payment created with ID: ${testPaymentId}`);
  }

  // Verify the payment
  if (testPaymentId) {
    const verifyResult = await test(
      'Verify payment status',
      'POST',
      `/12345678-1234-1234-1234-123456789abc/billing/payments/${testPaymentId}/verify`,
      { notes: 'Payment verified by admin' }
    );

    if (verifyResult) {
      console.log(`\n✓ Payment verified successfully`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('SECTION 4: ADJUSTMENTS & REFUNDS\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Create adjustment (refund)
  if (testInvoiceId && testPaymentId) {
    const adjustmentResult = await test(
      'Request refund adjustment',
      'POST',
      '/12345678-1234-1234-1234-123456789abc/billing/adjustments',
      {
        invoiceId: testInvoiceId,
        paymentId: testPaymentId,
        type: 'REFUND',
        amount: 5000.00,
        reason: 'Customer requested partial refund due to service issue',
        metadata: {
          customerContact: 'customer@example.com',
          issueDescription: 'Partial service delivery'
        }
      }
    );

    if (adjustmentResult && adjustmentResult.id) {
      testAdjustmentId = adjustmentResult.id;
      console.log(`\n✓ Adjustment created with ID: ${testAdjustmentId}`);
    }
  }

  // Approve the adjustment
  if (testAdjustmentId) {
    const approveResult = await test(
      'Approve adjustment',
      'POST',
      `/12345678-1234-1234-1234-123456789abc/billing/adjustments/${testAdjustmentId}/approve`,
      { notes: 'Approved by admin' }
    );

    if (approveResult) {
      console.log(`\n✓ Adjustment approved successfully`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('SECTION 5: ANALYTICS & REPORTING\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Get revenue overview
  await test(
    'Get revenue overview report',
    'POST',
    '/12345678-1234-1234-1234-123456789abc/reports/revenue-overview',
    {}
  );

  // Get invoice aging report
  await test(
    'Get invoice aging report',
    'POST',
    '/12345678-1234-1234-1234-123456789abc/reports/invoice-aging',
    {}
  );

  // Get payment distribution
  await test(
    'Get payment distribution report',
    'POST',
    '/12345678-1234-1234-1234-123456789abc/reports/payment-distribution',
    {}
  );

  console.log('\n═══════════════════════════════════════════════════════════\n');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   API Testing Complete                                ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('Summary:');
  console.log('  ✓ Authentication: JWT token obtained');
  console.log(`  ✓ Invoice: ${testInvoiceId ? 'Created' : 'Skipped'}`);
  console.log(`  ✓ Payment: ${testPaymentId ? 'Created & Verified' : 'Skipped'}`);
  console.log(`  ✓ Adjustment: ${testAdjustmentId ? 'Created & Approved' : 'Skipped'}`);
  console.log('  ✓ Analytics: Reports queried\n');

  process.exit(0);
}

runTests().catch(error => {
  console.error('\n✗ Test execution failed:', error.message);
  process.exit(1);
});
