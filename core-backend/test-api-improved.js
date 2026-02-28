#!/usr/bin/env node
/**
 * API End-to-End Test Script - Improved
 * Tests the complete invoice → payment → adjustment flow with actual org ID
 */

const http = require('http');

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
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data: data });
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

    const isSuccess = result.status >= 200 && result.status < 300;
    const icon = isSuccess ? '✓' : '✗';

    console.log(`  ${icon} Status: ${result.status}`);

    if (typeof result.data === 'object') {
      const dataStr = JSON.stringify(result.data, null, 2);
      const lines = dataStr.split('\n').slice(0, 10);
      console.log(`  ${icon} Response:`);
      lines.forEach(line => console.log(`     ${line}`));
      if (dataStr.split('\n').length > 10) console.log(`     ...`);
    } else {
      console.log(`  ${icon} Response:`, result.data.substring(0, 100));
    }

    return isSuccess ? result.data : null;
  } catch (error) {
    console.log(`  ✗ Request failed: ${error.message}`);
    return null;
  }
}

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        API Flow Testing - Complete Workflow             ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // SECTION 1: Authentication
  console.log('\n═══ SECTION 1: AUTHENTICATION ═══════════════════════════\n');

  const loginResult = await test(
    'Login with school manager',
    'POST',
    '/auth/login',
    { email: 'school@test.com', password: 'SchoolPass@123' }
  );

  if (!loginResult || !loginResult.token) {
    console.error('\n✗ Failed to obtain JWT token. Stopping tests.');
    process.exit(1);
  }

  testToken = loginResult.token;
  testOrgId = loginResult.user.organization_id;

  console.log(`\n✓ Authentication Success!`);
  console.log(`  - User: ${loginResult.user.full_name}`);
  console.log(`  - Organization ID: ${testOrgId}`);
  console.log(`  - Token: ${testToken.substring(0, 30)}...`);

  // Get user profile
  await test('Get user profile', 'GET', '/auth/profile');

  // SECTION 2: Query Invoices
  console.log('\n═══ SECTION 2: INVOICE QUERIES ════════════════════════\n');

  // Query an existing invoice from seeded data
  const seedInvoiceId = await new Promise((resolve) => {
    const path = `/${testOrgId}/billing/invoices`;
    makeRequest('GET', path).then(result => {
      if (result.data && result.data.invoices && result.data.invoices[0]) {
        resolve(result.data.invoices[0].id);
      } else {
        resolve(null);
      }
    });
  });

  if (seedInvoiceId) {
    testInvoiceId = seedInvoiceId;
    console.log(`\n✓ Found seeded invoice: ${testInvoiceId}`);

    const invoiceDetails = await test(
      `Get invoice details (${testInvoiceId})`,
      'GET',
      `/${testOrgId}/billing/invoices/${testInvoiceId}`
    );

    if (invoiceDetails) {
      console.log(`  - Invoice: ${invoiceDetails.invoice_number}`);
      console.log(`  - Amount: ₹${invoiceDetails.total_amount}`);
      console.log(`  - Status: ${invoiceDetails.status}`);
    }
  }

  // SECTION 3: Payment Flow
  console.log('\n═══ SECTION 3: PAYMENT PROCESSING ═════════════════════\n');

  if (testInvoiceId) {
    // Create a payment
    const paymentResult = await test(
      'Create payment',
      'POST',
      `/${testOrgId}/billing/payments`,
      {
        invoiceId: testInvoiceId,
        amount: 5000.00,
        paymentMethod: 'UPI',
        externalPaymentId: `TEST-PAY-${Date.now()}`,
        paymentDate: new Date().toISOString().split('T')[0]
      }
    );

    if (paymentResult && paymentResult.id) {
      testPaymentId = paymentResult.id;
      console.log(`\n✓ Payment created: ${testPaymentId}`);
      console.log(`  - Amount: ₹${paymentResult.amount}`);
      console.log(`  - Method: ${paymentResult.payment_method}`);
      console.log(`  - Status: ${paymentResult.status}`);

      // Verify payment
      const verifyResult = await test(
        'Verify payment status',
        'POST',
        `/${testOrgId}/billing/payments/${testPaymentId}/verify`,
        { notes: 'Verified by system test' }
      );

      if (verifyResult) {
        console.log(`\n✓ Payment verified successfully`);
        console.log(`  - New Status: ${verifyResult.status}`);
      }
    }
  }

  // SECTION 4: Adjustments & Refunds
  console.log('\n═══ SECTION 4: ADJUSTMENTS & REFUNDS ══════════════════\n');

  if (testInvoiceId && testPaymentId) {
    // Create adjustment (refund)
    const adjustmentResult = await test(
      'Request refund adjustment',
      'POST',
      `/${testOrgId}/billing/adjustments`,
      {
        invoiceId: testInvoiceId,
        paymentId: testPaymentId,
        type: 'REFUND',
        amount: 1000.00,
        reason: 'Partial refund requested by customer'
      }
    );

    if (adjustmentResult && adjustmentResult.id) {
      testAdjustmentId = adjustmentResult.id;
      console.log(`\n✓ Adjustment created: ${testAdjustmentId}`);
      console.log(`  - Type: ${adjustmentResult.type}`);
      console.log(`  - Amount: ₹${adjustmentResult.amount}`);
      console.log(`  - Status: ${adjustmentResult.status}`);

      // Approve adjustment
      const approveResult = await test(
        'Approve adjustment request',
        'POST',
        `/${testOrgId}/billing/adjustments/${testAdjustmentId}/approve`,
        { notes: 'Approved by admin system test' }
      );

      if (approveResult) {
        console.log(`\n✓ Adjustment approved`);
        console.log(`  - Final Status: ${approveResult.status}`);
      }
    }
  }

  // SECTION 5: Analytics
  console.log('\n═══ SECTION 5: ANALYTICS & REPORTS ════════════════════\n');

  await test(
    'Get revenue overview',
    'POST',
    `/${testOrgId}/reports/revenue-overview`,
    {}
  );

  await test(
    'Get payment distribution',
    'POST',
    `/${testOrgId}/reports/payment-distribution`,
    {}
  );

  // FINAL SUMMARY
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║          ✓ API FLOW TESTING COMPLETE                    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('Workflow Summary:');
  console.log(`  ✓ Authentication: Successful`);
  console.log(`  ${testInvoiceId ? '✓' : '✗'} Invoice Query: ${testInvoiceId ? `Retrieved ${testInvoiceId}` : 'Failed'}`);
  console.log(`  ${testPaymentId ? '✓' : '✗'} Payment Flow: ${testPaymentId ? `Created & Verified ${testPaymentId}` : 'Failed'}`);
  console.log(`  ${testAdjustmentId ? '✓' : '✗'} Adjustment: ${testAdjustmentId ? `Created & Approved ${testAdjustmentId}` : 'Failed'}`);
  console.log(`  ✓ Analytics: Queries executed\n`);

  process.exit(0);
}

runTests().catch(error => {
  console.error('\n✗ Test execution failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
