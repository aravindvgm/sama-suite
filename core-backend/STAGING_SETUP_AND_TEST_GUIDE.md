# Staging Database Setup & Test Execution Guide
## SAMA-SUITE Production-Readiness Validation

**Version:** 1.0
**Date:** 2026-02-15
**Target:** Clean staging environment → Run validation suite → Green light for pilot CA deployment

---

## 📋 PRE-EXECUTION CHECKLIST

Before starting staging setup:
- [ ] PostgreSQL 14+ installed and running
- [ ] Node.js 18+ available
- [ ] Git repository cloned with all migrations
- [ ] Environment variables configured (see below)
- [ ] Fresh database ready (no existing SAMA data)
- [ ] 30-45 minutes blocked for full execution

---

## 🔧 PHASE 1: ENVIRONMENT SETUP

### 1.1 Create Staging Environment File

Create `.env.staging` in project root:

```bash
# Database Configuration
DATABASE_URL=postgresql://sama_user:staging_password@localhost:5432/sama_staging
NODE_ENV=staging
PORT=5001

# JWT Configuration
JWT_SECRET=staging_jwt_secret_key_minlength_32chars_required_1234567
JWT_EXPIRY=24h

# Logging
LOG_LEVEL=info
ENABLE_AUDIT_LOGGING=true

# Testing
SEED_DATA=true
TEST_MODE=true
```

### 1.2 Create PostgreSQL User & Database

```bash
# Connect to PostgreSQL as superuser
psql -U postgres

# In psql prompt:
CREATE USER sama_user WITH PASSWORD 'staging_password';
CREATE DATABASE sama_staging OWNER sama_user;

# Grant privileges
GRANT CONNECT ON DATABASE sama_staging TO sama_user;
GRANT CREATE ON DATABASE sama_staging TO sama_user;

\q
```

### 1.3 Verify Database Connection

```bash
psql -U sama_user -d sama_staging -h localhost
# Should connect successfully
\q
```

---

## 🗄️ PHASE 2: APPLY DATABASE MIGRATIONS

### 2.1 Execute Migrations in Sequence

**CRITICAL: Apply migrations in this exact order**

```bash
cd e:\Works\SAMA_TECHNOLOGIES\SAMA-SUITE\core-backend

# Migration 1: Create audit logs table
psql -U sama_user -d sama_staging -h localhost -f db_migrations/001_create_audit_logs.sql

# Migration 2: Create payments table
psql -U sama_user -d sama_staging -h localhost -f db_migrations/002_create_payments_table.sql

# Migration 3: Create adjustments table
psql -U sama_user -d sama_staging -h localhost -f db_migrations/003_create_adjustments_table.sql

echo "✅ All migrations applied successfully"
```

### 2.2 Verify Migration Success

```bash
# Connect and check tables exist
psql -U sama_user -d sama_staging -h localhost

# In psql:
\dt
# Should show: audit_logs, payments, adjustments, (plus existing tables)

\d audit_logs
# Verify columns: id, organization_id, entity_type, action, changed_by, changed_at, etc.

\d payments
# Verify columns: id, organization_id, invoice_id, amount, status, external_payment_id, etc.

\d adjustments
# Verify columns: id, organization_id, invoice_id, type, amount, status, etc.

\q
```

### 2.3 Check Constraints & Indexes

```bash
psql -U sama_user -d sama_staging -h localhost

# Verify unique constraint on payments
\d payments
# Look for: UNIQUE (organization_id, external_payment_id)

# Exit
\q
```

---

## 🌱 PHASE 3: SEED TEST DATA

### 3.1 Create Seed Script

Create `db_migrations/seed_test_data.sql`:

```sql
-- ============================================================
-- SEED TEST DATA FOR PRODUCTION-READY VALIDATION
-- ============================================================

BEGIN;

-- Test Organization & Users (from existing schema)
INSERT INTO organizations (id, organization_name, industry_type, created_at, updated_at) VALUES
  ('test-org-001', 'Test CA Firm', 'APARTMENT', NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO users (id, full_name, email, password_hash, organization_id, platform_role, org_role, created_at, updated_at) VALUES
  ('test-user-admin-001', 'CA Admin Test', 'admin@testca.com', '$2b$10$...', 'test-org-001', 'USER', 'ORG_ADMIN', NOW(), NOW()),
  ('test-user-staff-001', 'CA Staff Test', 'staff@testca.com', '$2b$10$...', 'test-org-001', 'USER', 'ORG_USER', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Test Residents/Persons
INSERT INTO persons (id, organization_id, full_name, email, phone, created_at, updated_at) VALUES
  ('test-person-001', 'test-org-001', 'Test Resident 1', 'resident1@test.com', '9876543210', NOW(), NOW()),
  ('test-person-002', 'test-org-001', 'Test Resident 2', 'resident2@test.com', '9876543211', NOW(), NOW()),
  ('test-person-003', 'test-org-001', 'Test Resident 3', 'resident3@test.com', '9876543212', NOW(), NOW()),
  ('test-person-004', 'test-org-001', 'Test Resident 4', 'resident4@test.com', '9876543213', NOW(), NOW()),
  ('test-person-005', 'test-org-001', 'Test Resident 5', 'resident5@test.com', '9876543214', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Test Invoices
INSERT INTO invoices (id, organization_id, person_id, invoice_number, total_amount, due_date, status, notes, created_at, updated_at) VALUES
  ('test-invoice-001', 'test-org-001', 'test-person-001', 'INV-TEST-001', 10000, '2026-03-15', 'DRAFT', 'Full payment test', NOW(), NOW()),
  ('test-invoice-002', 'test-org-001', 'test-person-002', 'INV-TEST-002', 5000, '2026-03-15', 'DRAFT', 'Partial payment test', NOW(), NOW()),
  ('test-invoice-003', 'test-org-001', 'test-person-003', 'INV-TEST-003', 15000, '2026-03-15', 'DRAFT', 'Multiple payments test', NOW(), NOW()),
  ('test-invoice-004', 'test-org-001', 'test-person-004', 'INV-TEST-004', 8000, '2026-03-15', 'DRAFT', 'Refund test', NOW(), NOW()),
  ('test-invoice-005', 'test-org-001', 'test-person-005', 'INV-TEST-005', 12000, '2026-03-15', 'DRAFT', 'Idempotency test', NOW(), NOW())
ON CONFLICT DO NOTHING;

-- Test Invoice Items
INSERT INTO invoice_items (id, organization_id, invoice_id, item_name, quantity, unit_price, total_amount, created_at, updated_at) VALUES
  ('test-item-001', 'test-org-001', 'test-invoice-001', 'Maintenance', 1, 10000, 10000, NOW(), NOW()),
  ('test-item-002', 'test-org-001', 'test-invoice-002', 'Services', 1, 5000, 5000, NOW(), NOW()),
  ('test-item-003', 'test-org-001', 'test-invoice-003', 'Rent', 1, 10000, 10000, NOW(), NOW()),
  ('test-item-004', 'test-org-001', 'test-invoice-003', 'Utilities', 1, 5000, 5000, NOW(), NOW()),
  ('test-item-005', 'test-org-001', 'test-invoice-004', 'Fees', 1, 8000, 8000, NOW(), NOW()),
  ('test-item-006', 'test-org-001', 'test-invoice-005', 'Annual Fee', 1, 12000, 12000, NOW(), NOW())
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify seed data
SELECT 'Organizations' as entity, COUNT(*) as count FROM organizations WHERE organization_name LIKE 'Test%' UNION ALL
SELECT 'Users', COUNT(*) FROM users WHERE full_name LIKE '%Test%' UNION ALL
SELECT 'Persons', COUNT(*) FROM persons WHERE full_name LIKE 'Test%' UNION ALL
SELECT 'Invoices', COUNT(*) FROM invoices WHERE invoice_number LIKE 'INV-TEST%' UNION ALL
SELECT 'Invoice Items', COUNT(*) FROM invoice_items WHERE organization_id = 'test-org-001';
```

### 3.2 Apply Seed Data

```bash
psql -U sama_user -d sama_staging -h localhost -f db_migrations/seed_test_data.sql

# Expected output:
# entity          | count
# ================|=======
# Organizations   |     1
# Users           |     2
# Persons         |     5
# Invoices        |     5
# Invoice Items   |     6
```

### 3.3 Verify Seed Data

```bash
psql -U sama_user -d sama_staging -h localhost

# Check organization
SELECT id, organization_name FROM organizations WHERE id = 'test-org-001';
# Expected: test-org-001 | Test CA Firm

# Check users
SELECT id, full_name, org_role FROM users WHERE organization_id = 'test-org-001';
# Expected: 2 users (ADMIN and USER roles)

# Check invoices
SELECT id, invoice_number, total_amount, status FROM invoices WHERE organization_id = 'test-org-001';
# Expected: 5 invoices, all DRAFT status

\q
```

---

## 🧪 PHASE 4: BACKEND STARTUP & TOKEN GENERATION

### 4.1 Start Backend Server

```bash
cd e:\Works\SAMA_TECHNOLOGIES\SAMA-SUITE\core-backend

# Install dependencies (if not already done)
npm install

# Start server with staging config
NODE_ENV=staging npm start

# Output should show:
# Server running on port 5001
# Database connected to sama_staging
# ✅ Backend ready for testing
```

### 4.2 Generate Test Token (For Admin User)

```bash
# In a new terminal

curl -X POST http://localhost:5001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@testca.com",
    "password": "test_password_123"
  }'

# Response:
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "test-user-admin-001",
    "organization_id": "test-org-001",
    "orgRole": "ORG_ADMIN"
  }
}

# SAVE: TOKEN=$yourtoken (use in test runner)
# SAVE: ORG_ID=test-org-001
```

---

## ⚡ PHASE 5: RUN AUTOMATED TEST SUITE

### 5.1 Make Test Script Executable

```bash
chmod +x run_production_tests.sh
```

### 5.2 Execute Tests

```bash
# Set variables
export TEST_TOKEN="your_token_from_phase_4"
export TEST_ORG_ID="test-org-001"
export TEST_BASE_URL="http://localhost:5001"

# Run automated tests
./run_production_tests.sh $TEST_BASE_URL $TEST_TOKEN $TEST_ORG_ID

# Output format:
# ╔════════════════════════════════════════════════════════
# ║  SAMA-SUITE Production-Ready Test Suite
# ║  Base URL: http://localhost:5001
# ║  Org ID: test-org-001
# ╚════════════════════════════════════════════════════════
#
# ℹ️  Server connection verified ✓
#
# ═══════════════════════════════════════════════════════
#   TEST 1: Full Payment Lifecycle (DRAFT→SENT→PAID)
# ═══════════════════════════════════════════════════════
# ✅ PASS: Invoice created in DRAFT
# ✅ PASS: Invoice sent (DRAFT→SENT)
# ✅ PASS: Payment created (PENDING_VERIFICATION)
# ✅ PASS: Payment verified (PENDING→VERIFIED)
# ✅ PASS: Invoice auto-updated to PAID
#
# ... (continuing for all 6 test scenarios)
```

### 5.3 Monitor Test Execution

Watch for:
- ✅ All PASS statuses
- ❌ Any FAIL statuses (investigate immediately)
- Timing (should complete in < 60 seconds)
- No server errors in backend logs

---

## 📊 PHASE 6: INTERPRET RESULTS

### 6.1 Test Results Interpretation

**Passing Test Results:**
```
═══════════════════════════════════════════════════════
  TEST RESULTS SUMMARY
═══════════════════════════════════════════════════════
Total Tests Run: 6
Passed: 6
Failed: 0

Pass Rate: 100%
✅ ALL TESTS PASSED - PRODUCTION READY
```

**What This Means:**
- ✅ All financial flows work correctly
- ✅ Idempotency prevents duplicate payments
- ✅ Overpayment logic is enforced
- ✅ Audit trail is complete
- ✅ Reconciliation math is accurate
- ✅ System is ready for CA pilot

### 6.2 Failure Investigation

If you see ❌ FAIL results:

**Scenario: FAIL - Invoice auto-updated to PAID**

Steps to investigate:
```bash
# 1. Check backend logs for errors
# Look for: "[ERROR]" messages in console

# 2. Verify payment was actually verified
curl -X GET http://localhost:5001/api/test-org-001/billing/payments/[payment-id] \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '.data.status'
# Should output: "VERIFIED"

# 3. Check invoice status directly
curl -X GET http://localhost:5001/api/test-org-001/billing/invoices/[invoice-id] \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '.data.status'
# Should output: "PAID"

# 4. Check if payment service is correctly integrated
# Review: src/modules/billing/payment.service.js:verifyPayment()
# Line: const newInvoiceStatus calculation

# 5. Restart backend and retry test
npm restart
```

### 6.3 Common Failures & Solutions

| Failure | Cause | Solution |
|---------|-------|----------|
| "Invoice not found" | Invoice migration didn't apply | Re-run migrations, verify tables exist |
| "Payment exceeds invoice total" | Overpayment validation working (actually a PASS) | Expected behavior, test is validating correctly |
| "Audit trail missing entries" | Audit service not enabled | Check `NODE_ENV=staging` and audit logging config |
| "Connection refused" | Backend not running | Run `npm start` in new terminal on port 5001 |
| "Invalid token" | Token expired or incorrect | Regenerate token from Phase 4.2 |

---

## ✅ PHASE 7: RECONCILIATION VALIDATION (MANUAL)

### 7.1 Deep-Dive Reconciliation Check

After all automated tests pass, manually validate reconciliation accuracy:

```bash
# Get reconciliation report for first test invoice
curl -X GET http://localhost:5001/api/test-org-001/billing/payments/reconciliation/test-invoice-001 \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '.data'

# Expected output:
{
  "invoice": {
    "id": "test-invoice-001",
    "total": 10000,
    "status": "PAID"
  },
  "payments": {
    "VERIFIED": {
      "count": 1,
      "activeAmount": 10000,
      "refundedAmount": 0
    }
  },
  "summary": {
    "totalVerified": 10000,
    "totalRefunded": 0,
    "netCollected": 10000,
    "remainingBalance": 0,
    "collectionPercentage": "100.00",
    "reconciliationStatus": "FULLY_PAID"
  },
  "isReconciled": true
}
```

### 7.2 Validation Checklist

- [ ] `totalVerified` equals invoice `total`
- [ ] `remainingBalance` equals 0
- [ ] `collectionPercentage` equals "100.00"
- [ ] `reconciliationStatus` equals "FULLY_PAID"
- [ ] `isReconciled` equals true

### 7.3 Audit Trail Validation

```bash
# Get audit trail for test invoice
curl -X GET http://localhost:5001/api/test-org-001/reports/audit-trail/test-invoice-001 \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '.data | length'

# Expected: At least 3 entries (CREATE, SEND, PAYMENT VERIFY, INVOICE UPDATE)

# Verify audit integrity
curl -X GET http://localhost:5001/api/test-org-001/reports/audit-integrity/test-invoice-001 \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '.data.status'

# Expected: "ok"
```

---

## 🎉 PHASE 8: SIGN-OFF CHECKLIST

### 8.1 Complete This Checklist

Before proceeding to pilot deployment:

```
STAGING VALIDATION SIGN-OFF
===========================

[ ] Database migrations applied successfully (001, 002, 003)
[ ] Test data seeded (5 test invoices, 5 test persons)
[ ] Backend started on port 5001
[ ] Test token generated for admin user
[ ] Automated test runner executed
[ ] All 6 test scenarios PASSED
[ ] Pass rate = 100%
[ ] Zero failed tests
[ ] Reconciliation math verified (100% accuracy)
[ ] Audit trails complete and accurate
[ ] No server errors in logs
[ ] No security vulnerabilities identified

SIGN-OFF: ____________________        DATE: ______________
          (Backend Lead/CTO)

Can proceed to: [ ] Pilot CA Deployment
```

### 8.2 Generate Test Report

```bash
# Create test report
cat > TEST_REPORT_$(date +%Y%m%d).md << 'EOF'
# Production-Ready Test Report
**Date:** $(date)
**Environment:** Staging (sama_staging)
**Test Organization:** test-org-001

## Results Summary
- Total Tests: 6
- Passed: 6
- Failed: 0
- Pass Rate: 100%

## Test Scenarios Passed
1. ✅ Full Payment Lifecycle
2. ✅ Duplicate Webhook Idempotency
3. ✅ Overpayment Prevention
4. ✅ Audit Trail Completeness
5. ✅ Reconciliation Math
6. ✅ Multi-Tenant Isolation

## Validation Status
✅ PRODUCTION READY - Approved for pilot CA deployment

## Sign-Off
- Backend Lead: _______________
- Finance/Product: _______________
- Security: _______________

EOF
```

---

## 🚀 PHASE 9: CLEANUP & PILOT PREP

### 9.1 Final Verification Commands

```bash
# Run health check
curl -X GET http://localhost:5001/ \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '.message'
# Expected: "Sama Technologies Core Backend Running 🚀"

# Verify database is clean (no leftover data)
psql -U sama_user -d sama_staging -h localhost -c "SELECT COUNT(*) FROM payments WHERE organization_id = 'test-org-001';"
# Expected: Should show payment count from tests (normally 1-5 depending on test state)

# Check audit log entries
psql -U sama_user -d sama_staging -h localhost -c "SELECT COUNT(*) FROM audit_logs WHERE organization_id = 'test-org-001';"
# Expected: 5+ entries from test execution
```

### 9.2 Optional: Reset Staging (For Next Test Run)

```bash
# Stop backend
Ctrl+C

# Backup current database
pg_dump -U sama_user -d sama_staging > sama_staging_backup_$(date +%Y%m%d).sql

# Optional: Truncate test data
psql -U sama_user -d sama_staging << EOF
DELETE FROM audit_logs WHERE organization_id = 'test-org-001';
DELETE FROM payments WHERE organization_id = 'test-org-001';
DELETE FROM adjustments WHERE organization_id = 'test-org-001';
DELETE FROM invoice_items WHERE organization_id = 'test-org-001';
DELETE FROM invoices WHERE organization_id = 'test-org-001';
DELETE FROM persons WHERE organization_id = 'test-org-001';
EOF

# Restart backend
npm start
```

---

## 📚 APPENDIX: TROUBLESHOOTING

### Connection Errors

**Error:** `psql: could not translate host name "localhost" to address`

**Solution:**
```bash
# Use 127.0.0.1 instead
psql -U sama_user -d sama_staging -h 127.0.0.1
```

### Migration Errors

**Error:** `ERROR: relation "audit_logs" already exists`

**Solution:**
```bash
# Drop and recreate database
dropdb -U same_user sama_staging
createdb -U sama_user sama_staging
# Re-run migrations
```

### Backend Connection Errors

**Error:** `Error: connect ECONNREFUSED 127.0.0.1:5432`

**Solution:**
```bash
# Check PostgreSQL is running
# macOS: brew services list
# Linux: sudo systemctl status postgresql
# Windows: Check Services app
```

### Test Timeout

**Error:** `Test timed out after 30 seconds`

**Solution:**
- Increase timeout in test runner: `timeout: 60000`
- Check network latency: `ping localhost`
- Restart backend: `npm restart`

---

## 🎯 SUCCESS CRITERIA - Final Checklist

✅ **MUST PASS:**
1. Zero database migration errors
2. 100% test pass rate (6/6)
3. Reconciliation accurate to the penny
4. Audit trail complete for all mutations
5. No server errors in logs
6. Multi-tenant isolation verified
7. Idempotency working (duplicate prevention)

✅ **OPTIONAL (NICE TO HAVE):**
- Response time < 200ms (95th percentile)
- 10+ concurrent requests handled
- Load test with 100+ invoices

---

**When all checks pass: APPROVED for Pilot CA Deployment ✅**

**Next Step:** Deploy to production staging, configure DNS, onboard 2-3 pilot CA firms

