#!/bin/bash

##############################################################################
# SAMA-SUITE Production-Ready Test Runner
# Automated validation of critical financial transaction flows
# Usage: ./run_production_tests.sh <base_url> <token> <org_id>
##############################################################################

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${1:-http://localhost:5000}"
TOKEN="${2:-your-token}"
ORG_ID="${3:-your-org-id}"
RESULTS_FILE="test_results_$(date +%Y%m%d_%H%M%S).json"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function: Print colored output
log_test() {
  local status=$1
  local message=$2
  if [ "$status" = "PASS" ]; then
    echo -e "${GREEN}✅ PASS${NC}: $message"
    ((TESTS_PASSED++))
  else
    echo -e "${RED}❌ FAIL${NC}: $message"
    ((TESTS_FAILED++))
  fi
  ((TESTS_RUN++))
}

log_info() {
  echo -e "${YELLOW}ℹ️${NC}  $1"
}

log_section() {
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  $1"
  echo "═══════════════════════════════════════════════════════"
}

##############################################################################
# Test Scenario 1: Full Payment Lifecycle
##############################################################################
test_full_payment_lifecycle() {
  log_section "TEST 1: Full Payment Lifecycle (DRAFT→SENT→PAID)"

  # Create invoice
  INVOICE=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/invoices" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "person_id": "test-resident-001",
      "due_date": "2026-03-15",
      "notes": "Test invoice - Full payment",
      "items": [{"item_name": "Maintenance", "quantity": 1, "unit_price": 10000}]
    }')

  local invoice_id=$(echo "$INVOICE" | jq -r '.data.invoice.id // "null"')
  local invoice_status=$(echo "$INVOICE" | jq -r '.data.invoice.status // "null"')

  [ "$invoice_status" = "DRAFT" ] && log_test "PASS" "Invoice created in DRAFT" || log_test "FAIL" "Invoice creation failed"

  # Send invoice
  SENT=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/invoices/$invoice_id/send" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json")

  local sent_status=$(echo "$SENT" | jq -r '.data.status // "null"')
  [ "$sent_status" = "SENT" ] && log_test "PASS" "Invoice sent (DRAFT→SENT)" || log_test "FAIL" "Invoice send failed"

  # Create payment
  PAYMENT=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "invoice_id": "'$invoice_id'",
      "amount": 10000,
      "payment_method": "UPI",
      "external_payment_id": "UPI-TEST-001-'$(date +%s)'",
      "payment_date": "2026-02-16"
    }')

  local payment_id=$(echo "$PAYMENT" | jq -r '.data.payment.id // "null"')
  local payment_status=$(echo "$PAYMENT" | jq -r '.data.payment.status // "null"')

  [ "$payment_status" = "PENDING_VERIFICATION" ] && log_test "PASS" "Payment created (PENDING_VERIFICATION)" || log_test "FAIL" "Payment creation failed"

  # Verify payment
  VERIFIED=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments/$payment_id/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"notes": "Verified"}')

  local verified_status=$(echo "$VERIFIED" | jq -r '.data.payment.status // "null"')
  [ "$verified_status" = "VERIFIED" ] && log_test "PASS" "Payment verified (PENDING→VERIFIED)" || log_test "FAIL" "Payment verification failed"

  # Check invoice auto-updated to PAID
  INVOICE_CHECK=$(curl -s -X GET "$BASE_URL/api/$ORG_ID/billing/invoices/$invoice_id" \
    -H "Authorization: Bearer $TOKEN")

  local final_status=$(echo "$INVOICE_CHECK" | jq -r '.data.status // "null"')
  [ "$final_status" = "PAID" ] && log_test "PASS" "Invoice auto-updated to PAID" || log_test "FAIL" "Invoice auto-update failed"
}

##############################################################################
# Test Scenario 2: Duplicate Webhook Idempotency
##############################################################################
test_idempotency() {
  log_section "TEST 2: Duplicate Webhook Idempotency"

  # Create test invoice
  INVOICE=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/invoices" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "person_id": "test-resident-002",
      "due_date": "2026-03-15",
      "items": [{"item_name": "Test", "quantity": 1, "unit_price": 5000}]
    }')

  local invoice_id=$(echo "$INVOICE" | jq -r '.data.invoice.id')
  local external_payment_id="UPI-IDEM-001-$(date +%s)"

  # First payment
  PAYMENT_1=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "invoice_id": "'$invoice_id'",
      "amount": 5000,
      "payment_method": "UPI",
      "external_payment_id": "'$external_payment_id'",
      "payment_date": "2026-02-16"
    }')

  local payment_id_1=$(echo "$PAYMENT_1" | jq -r '.data.payment.id')
  local is_new_1=$(echo "$PAYMENT_1" | jq -r '.data.isNew')

  # Duplicate payment (webhook retry)
  sleep 1
  PAYMENT_2=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "invoice_id": "'$invoice_id'",
      "amount": 5000,
      "payment_method": "UPI",
      "external_payment_id": "'$external_payment_id'",
      "payment_date": "2026-02-16"
    }')

  local payment_id_2=$(echo "$PAYMENT_2" | jq -r '.data.payment.id')
  local is_new_2=$(echo "$PAYMENT_2" | jq -r '.data.isNew')

  # Validate idempotency
  [ "$is_new_1" = "true" ] && log_test "PASS" "First call: isNew=true" || log_test "FAIL" "First call: isNew should be true"
  [ "$is_new_2" = "false" ] && log_test "PASS" "Retry call: isNew=false" || log_test "FAIL" "Retry call: isNew should be false"
  [ "$payment_id_1" = "$payment_id_2" ] && log_test "PASS" "Same payment ID returned" || log_test "FAIL" "Payment IDs differ"
}

##############################################################################
# Test Scenario 3: Overpayment Prevention
##############################################################################
test_overpayment_prevention() {
  log_section "TEST 3: Overpayment Prevention"

  # Create invoice for 5000
  INVOICE=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/invoices" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "person_id": "test-resident-003",
      "due_date": "2026-03-15",
      "items": [{"item_name": "Test", "quantity": 1, "unit_price": 5000}]
    }')

  local invoice_id=$(echo "$INVOICE" | jq -r '.data.invoice.id')

  # Attempt overpayment (6000 > 5000)
  OVERPAY=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "invoice_id": "'$invoice_id'",
      "amount": 6000,
      "payment_method": "UPI",
      "external_payment_id": "UPI-OVER-001",
      "payment_date": "2026-02-16"
    }')

  local error=$(echo "$OVERPAY" | jq -r '.message // "no error"')
  [[ "$error" == *"exceeds"* ]] && log_test "PASS" "Overpayment rejected" || log_test "FAIL" "Overpayment not prevented: $error"
}

##############################################################################
# Test Scenario 4: Audit Trail Completeness
##############################################################################
test_audit_trail() {
  log_section "TEST 4: Audit Trail Completeness"

  # Create simple invoice-payment flow
  INVOICE=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/invoices" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "person_id": "test-resident-004",
      "due_date": "2026-03-15",
      "items": [{"item_name": "Test", "quantity": 1, "unit_price": 3000}]
    }')

  local invoice_id=$(echo "$INVOICE" | jq -r '.data.invoice.id')

  # Send and pay
  curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/invoices/$invoice_id/send" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" > /dev/null

  PAYMENT=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "invoice_id": "'$invoice_id'",
      "amount": 3000,
      "payment_method": "UPI",
      "external_payment_id": "UPI-AUDIT-001",
      "payment_date": "2026-02-16"
    }')

  local payment_id=$(echo "$PAYMENT" | jq -r '.data.payment.id')

  curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments/$payment_id/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' > /dev/null

  # Get audit trail
  AUDIT=$(curl -s -X GET "$BASE_URL/api/$ORG_ID/reports/audit-trail/$invoice_id" \
    -H "Authorization: Bearer $TOKEN")

  local entry_count=$(echo "$AUDIT" | jq '.data | length')
  [ "$entry_count" -ge 2 ] && log_test "PASS" "Audit trail has $entry_count entries" || log_test "FAIL" "Audit trail missing entries"

  # Check first entry is CREATE
  local first_action=$(echo "$AUDIT" | jq -r '.data[0].action')
  [ "$first_action" = "CREATE" ] && log_test "PASS" "First audit entry is CREATE" || log_test "FAIL" "First entry should be CREATE, got $first_action"
}

##############################################################################
# Test Scenario 5: Reconciliation Math
##############################################################################
test_reconciliation() {
  log_section "TEST 5: Reconciliation Math"

  # Create invoice for 10000
  INVOICE=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/invoices" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "person_id": "test-resident-005",
      "due_date": "2026-03-15",
      "items": [{"item_name": "Test", "quantity": 1, "unit_price": 10000}]
    }')

  local invoice_id=$(echo "$INVOICE" | jq -r '.data.invoice.id')

  # Make payment and verify
  PAYMENT=$(curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "invoice_id": "'$invoice_id'",
      "amount": 10000,
      "payment_method": "UPI",
      "external_payment_id": "UPI-RECON-001",
      "payment_date": "2026-02-16"
    }')

  local payment_id=$(echo "$PAYMENT" | jq -r '.data.payment.id')

  curl -s -X POST "$BASE_URL/api/$ORG_ID/billing/payments/$payment_id/verify" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' > /dev/null

  # Get reconciliation
  RECON=$(curl -s -X GET "$BASE_URL/api/$ORG_ID/billing/payments/reconciliation/$invoice_id" \
    -H "Authorization: Bearer $TOKEN")

  local total_verified=$(echo "$RECON" | jq '.data.summary.totalVerified')
  local is_reconciled=$(echo "$RECON" | jq '.data.isReconciled')
  local collection_pct=$(echo "$RECON" | jq '.data.summary.collectionPercentage')

  [ "$total_verified" = "10000" ] && log_test "PASS" "Total verified = 10000" || log_test "FAIL" "Total verified incorrect: $total_verified"
  [ "$is_reconciled" = "true" ] && log_test "PASS" "Invoice is reconciled" || log_test "FAIL" "Invoice not reconciled"
  [ "$collection_pct" = "\"100.00\"" ] && log_test "PASS" "Collection % = 100.00" || log_test "FAIL" "Collection % incorrect: $collection_pct"
}

##############################################################################
# Test Scenario 6: Multi-Tenant Isolation
##############################################################################
test_multi_tenant_isolation() {
  log_section "TEST 6: Multi-Tenant Isolation"

  log_info "Testing data isolation between organizations..."
  log_test "INFO" "Multi-tenant isolation test requires second org - manual verification needed"
  # This would require creating a second organization and token
  # Skipping automated test, marked for manual verification
}

##############################################################################
# Main test execution
##############################################################################
main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════"
  echo "║  SAMA-SUITE Production-Ready Test Suite"
  echo "║  Base URL: $BASE_URL"
  echo "║  Org ID: $ORG_ID"
  echo "╚════════════════════════════════════════════════════════"
  echo ""

  # Verify connection
  HEALTH=$(curl -s -X GET "$BASE_URL/" -H "Authorization: Bearer $TOKEN")
  local server_ok=$(echo "$HEALTH" | jq -r '.success // "false"')

  if [ "$server_ok" != "true" ]; then
    echo -e "${RED}❌ Server unreachable or token invalid${NC}"
    echo "Please verify BASE_URL and TOKEN"
    exit 1
  fi

  log_info "Server connection verified ✓"
  echo ""

  # Run all tests
  test_full_payment_lifecycle
  test_idempotency
  test_overpayment_prevention
  test_audit_trail
  test_reconciliation
  test_multi_tenant_isolation

  # Summary
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  TEST RESULTS SUMMARY"
  echo "═══════════════════════════════════════════════════════"
  echo -e "Total Tests Run: ${YELLOW}$TESTS_RUN${NC}"
  echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
  echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
  echo ""

  local pass_rate=$((TESTS_PASSED * 100 / TESTS_RUN))
  echo "Pass Rate: $pass_rate%"

  if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED - PRODUCTION READY${NC}"
    exit 0
  else
    echo -e "${RED}❌ TESTS FAILED - FIX ISSUES BEFORE DEPLOYMENT${NC}"
    exit 1
  fi
}

# Handle arguments
if [ "$BASE_URL" = "-h" ] || [ "$BASE_URL" = "--help" ]; then
  echo "Usage: ./run_production_tests.sh <base_url> <token> <org_id>"
  echo ""
  echo "Example:"
  echo "  ./run_production_tests.sh http://localhost:5000 'eyJhbGc...' '123e4567-e89b-12d3'"
  exit 0
fi

main
