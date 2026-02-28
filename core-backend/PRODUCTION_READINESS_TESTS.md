# Production-Readiness Validation Suite
## SAMA-SUITE Financial Integrity Testing

**Objective:** Validate all financial transaction flows, reconciliation accuracy, audit trail completeness, and system constraints before pilot CA deployment.

**Last Updated:** 2026-02-15
**Status:** Ready for Execution
**Target:** 100% pass rate on all test scenarios

---

## 📋 TEST EXECUTION CHECKLIST

### Phase 1: Setup & Data Preparation
- [ ] Database migrations executed (001, 002, 003)
- [ ] JWT token obtained for test organization
- [ ] Test residents/persons created in database
- [ ] Multiple test organizations set up for isolation testing

### Phase 2: Core Financial Flows (Critical Path)
- [ ] Test Scenario 1: Full Payment Lifecycle (DRAFT→SENT→PAID)
- [ ] Test Scenario 2: Partial Payment with Status Transitions
- [ ] Test Scenario 3: Multiple Payments to Single Invoice
- [ ] Test Scenario 4: Refund Request & Approval Workflow

### Phase 3: Edge Cases & Error Handling
- [ ] Test Scenario 5: Duplicate Webhook Idempotency
- [ ] Test Scenario 6: Overpayment Prevention
- [ ] Test Scenario 7: Invalid State Transitions
- [ ] Test Scenario 8: Adjustment Rejection & Re-request

### Phase 4: Reconciliation Validation
- [ ] Test Scenario 9: Invoice Reconciliation Math
- [ ] Test Scenario 10: Payment Integrity Check
- [ ] Test Scenario 11: Refund Impact on Reconciliation
- [ ] Test Scenario 12: State Distribution Accuracy

### Phase 5: Audit & Compliance
- [ ] Test Scenario 13: Complete Audit Trail for Invoice
- [ ] Test Scenario 14: Audit Trail for Payment Verification
- [ ] Test Scenario 15: Audit Integrity Verification
- [ ] Test Scenario 16: User Action Traceability

### Phase 6: Multi-Tenant Isolation
- [ ] Test Scenario 17: Org Isolation (No Data Leakage)
- [ ] Test Scenario 18: Permission Enforcement (ORG_ADMIN only)
- [ ] Test Scenario 19: Concurrent Operations Safety

---

## 🧪 DETAILED TEST SCENARIOS

### Test Scenario 1: Full Payment Lifecycle (DRAFT→SENT→PAID)

**Objective:** Validate complete invoice flow from creation to full payment with auto-status updates

**Setup:**
```bash
# Step 1: Register test organization
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "CA Test Admin",
    "email": "test-ca-admin@testorg.com",
    "password": "TestCA@123456",
    "organization_name": "Test CA Firm",
    "industry_type": "APARTMENT"
  }'

# Save: TOKEN, ORG_ID
```

**Execution:**
```bash
# Step 2: Create invoice (Status: DRAFT)
TEST_ORG_ID="your-org-id"
TEST_TOKEN="your-token"
TEST_PERSON_ID="test-resident-001"

INVOICE_CREATE=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/invoices \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "person_id": "'$TEST_PERSON_ID'",
    "due_date": "2026-03-15",
    "notes": "Test invoice - Full payment scenario",
    "items": [
      {
        "item_name": "Monthly Maintenance",
        "quantity": 1,
        "unit_price": 10000
      }
    ]
  }')

INVOICE_ID=$(echo $INVOICE_CREATE | jq -r '.data.invoice.id')
echo "Invoice created: $INVOICE_ID (Status: DRAFT)"

# Step 3: Send invoice (DRAFT → SENT)
curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/invoices/$INVOICE_ID/send \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" | jq '.data.status'
# Expected: "SENT"

# Step 4: Create payment (PENDING_VERIFICATION)
PAYMENT_CREATE=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 10000,
    "payment_method": "UPI",
    "external_payment_id": "UPI-TEST-001-FULLPAY",
    "payment_date": "2026-02-16"
  }')

PAYMENT_ID=$(echo $PAYMENT_CREATE | jq -r '.data.payment.id')
echo "Payment created: $PAYMENT_ID (Status: PENDING_VERIFICATION)"

# Step 5: Verify payment (PENDING → VERIFIED)
curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments/$PAYMENT_ID/verify \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Payment verified against bank statement"
  }' | jq '.data.payment.status'
# Expected: "VERIFIED"

# Step 6: Get invoice (Should auto-update to PAID)
curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/invoices/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN" | jq '.data.status'
# Expected: "PAID"
```

**Validation:**
- ✅ Invoice status transitions: DRAFT → SENT → PAID
- ✅ Payment status transitions: PENDING_VERIFICATION → VERIFIED
- ✅ Invoice status auto-updated after payment verification
- ✅ Audit trail has 4 entries: CREATE, SEND, PAYMENT (CREATE, VERIFY), INVOICE (UPDATE)

**Pass Criteria:**
```json
{
  "invoice_status": "PAID",
  "payment_status": "VERIFIED",
  "audit_entries": 5,
  "reconciliation": {
    "totalVerified": 10000,
    "invoiceTotal": 10000,
    "isReconciled": true
  }
}
```

---

### Test Scenario 2: Partial Payment with Status Transitions

**Objective:** Validate PENDING → PARTIAL → PAID flow with multiple payment installments

**Execution:**
```bash
# Create invoice for ₹5,000
INVOICE_ID="inv-test-002"
# (Create as in Scenario 1)

# Payment 1: ₹3,000 (Status should become PARTIAL)
PAYMENT1=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 3000,
    "payment_method": "UPI",
    "external_payment_id": "UPI-TEST-002-PARTIAL1",
    "payment_date": "2026-02-16"
  }')

PAYMENT_ID_1=$(echo $PAYMENT1 | jq -r '.data.payment.id')

# Verify payment 1
curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments/$PAYMENT_ID_1/verify \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Partial payment received"}' > /dev/null

# Check invoice status (should be PARTIAL)
STATUS_1=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/invoices/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN" | jq -r '.data.status')
echo "After Payment 1: Status = $STATUS_1 (Expected: PARTIAL)"

# Payment 2: ₹2,000 (Status should become PAID)
PAYMENT2=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 2000,
    "payment_method": "UPI",
    "external_payment_id": "UPI-TEST-002-PARTIAL2",
    "payment_date": "2026-02-17"
  }')

PAYMENT_ID_2=$(echo $PAYMENT2 | jq -r '.data.payment.id')

# Verify payment 2
curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments/$PAYMENT_ID_2/verify \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Final payment received"}' > /dev/null

# Check invoice status (should be PAID)
STATUS_2=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/invoices/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN" | jq -r '.data.status')
echo "After Payment 2: Status = $STATUS_2 (Expected: PAID)"
```

**Validation:**
- ✅ First payment: PENDING → PARTIAL
- ✅ Second payment: PARTIAL → PAID (total collected = invoice total)
- ✅ Reconciliation: ₹3,000 + ₹2,000 = ₹5,000

**Pass Criteria:** Status transitions are automatic and correct

---

### Test Scenario 3: Duplicate Webhook Idempotency

**Objective:** Verify that webhook retries don't create duplicate payments

**Execution:**
```bash
INVOICE_ID="inv-test-003"
EXTERNAL_PAYMENT_ID="UPI-TEST-003-IDEMPOTENT"

# First webhook call
PAYMENT_1=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 5000,
    "payment_method": "UPI",
    "external_payment_id": "'$EXTERNAL_PAYMENT_ID'",
    "payment_date": "2026-02-16"
  }')

PAYMENT_ID_FIRST=$(echo $PAYMENT_1 | jq -r '.data.payment.id')
IS_NEW_FIRST=$(echo $PAYMENT_1 | jq -r '.data.isNew')
echo "First call: Payment ID = $PAYMENT_ID_FIRST, isNew = $IS_NEW_FIRST"

# EXACT SAME webhook call (retry)
sleep 2
PAYMENT_2=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 5000,
    "payment_method": "UPI",
    "external_payment_id": "'$EXTERNAL_PAYMENT_ID'",
    "payment_date": "2026-02-16"
  }')

PAYMENT_ID_SECOND=$(echo $PAYMENT_2 | jq -r '.data.payment.id')
IS_NEW_SECOND=$(echo $PAYMENT_2 | jq -r '.data.isNew')
echo "Second call (retry): Payment ID = $PAYMENT_ID_SECOND, isNew = $IS_NEW_SECOND"

# Verify
if [ "$PAYMENT_ID_FIRST" = "$PAYMENT_ID_SECOND" ] && [ "$IS_NEW_FIRST" = "true" ] && [ "$IS_NEW_SECOND" = "false" ]; then
  echo "✅ IDEMPOTENCY PASSED: Same payment ID returned, isNew correctly changed"
else
  echo "❌ IDEMPOTENCY FAILED: Different payment IDs or incorrect isNew flags"
fi

# Verify payment integrity (should not have duplicates)
INTEGRITY=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/payments/integrity/$EXTERNAL_PAYMENT_ID \
  -H "Authorization: Bearer $TEST_TOKEN")
echo "Integrity check: $(echo $INTEGRITY | jq '.message')"
```

**Validation:**
- ✅ First call: `isNew: true`, payment created
- ✅ Second call: `isNew: false`, same payment returned
- ✅ Database has exactly ONE payment record for this external_payment_id

**Pass Criteria:** `isNew` flag changes, payment ID remains same, no duplicates created

---

### Test Scenario 4: Overpayment Prevention

**Objective:** Verify system rejects payments exceeding invoice amount or remaining balance

**Execution:**
```bash
INVOICE_ID="inv-test-004"
INVOICE_TOTAL=5000

# Create invoice for ₹5,000
# (As in previous scenarios)

# Attempt 1: Payment exceeds invoice total
OVERPAY_FULL=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 6000,
    "payment_method": "UPI",
    "external_payment_id": "UPI-TEST-004-OVERFULL",
    "payment_date": "2026-02-16"
  }')

ERROR_1=$(echo $OVERPAY_FULL | jq -r '.message')
echo "Attempt 1 (Overpay full): $ERROR_1"
# Expected: "Payment exceeds invoice total of ₹5000"

# Make first partial payment: ₹3,000
PAYMENT_1=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 3000,
    "payment_method": "UPI",
    "external_payment_id": "UPI-TEST-004-PARTIAL",
    "payment_date": "2026-02-16"
  }')

PAYMENT_ID=$(echo $PAYMENT_1 | jq -r '.data.payment.id')
curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments/$PAYMENT_ID/verify \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' > /dev/null

# Attempt 2: Payment exceeds remaining balance (₹5,000 - ₹3,000 = ₹2,000 remaining)
OVERPAY_PARTIAL=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/payments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoice_id": "'$INVOICE_ID'",
    "amount": 3000,
    "payment_method": "UPI",
    "external_payment_id": "UPI-TEST-004-OVERPARTIAL",
    "payment_date": "2026-02-17"
  }')

ERROR_2=$(echo $OVERPAY_PARTIAL | jq -r '.message')
echo "Attempt 2 (Overpay remaining): $ERROR_2"
# Expected: "Payment (₹3000) exceeds remaining balance (₹2000)"
```

**Validation:**
- ✅ Full overpayment rejected
- ✅ Partial overpayment rejected
- ✅ Exact amounts within remaining balance accepted

**Pass Criteria:** All overpayment attempts rejected with clear error messages

---

### Test Scenario 5: Refund Request & Approval with Auto-Reconciliation

**Objective:** Verify refund workflow: REQUEST → APPROVE → AUTO-RECONCILE

**Execution:**
```bash
INVOICE_ID="inv-test-005"

# Setup: Create and verify full payment of ₹10,000
# (As in previous scenarios)
# Result: Invoice status = PAID, Payment status = VERIFIED

# Request refund (Adjustment created with PENDING status)
REFUND_REQUEST=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "'$INVOICE_ID'",
    "type": "REFUND",
    "amount": 5000,
    "reason": "Resident requested partial refund",
    "paymentId": "'$PAYMENT_ID'",
    "metadata": {
      "refundMethod": "UPI_REVERSE"
    }
  }')

ADJ_ID=$(echo $REFUND_REQUEST | jq -r '.data.adjustment.id')
ADJ_STATUS=$(echo $REFUND_REQUEST | jq -r '.data.adjustment.status')
echo "Refund requested: Adjustment ID = $ADJ_ID, Status = $ADJ_STATUS"
# Expected: Status = "PENDING"

# Approve refund (Should auto-reconcile)
REFUND_APPROVE=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments/$ADJ_ID/approve \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": "Refund approved and processed"
  }')

ADJ_NEW_STATUS=$(echo $REFUND_APPROVE | jq -r '.data.adjustment.status')
PAYMENT_NEW_STATUS=$(echo $REFUND_APPROVE | jq -r '.data.paymentImpact.new_status')
INVOICE_NEW_STATUS=$(echo $REFUND_APPROVE | jq -r '.data.invoiceStatusChange.new_status')
RECONCILIATION=$(echo $REFUND_APPROVE | jq -r '.data.reconciliation')

echo "After approval:"
echo "  Adjustment status: $ADJ_NEW_STATUS (Expected: APPROVED)"
echo "  Payment status: $PAYMENT_NEW_STATUS (Expected: REFUNDED)"
echo "  Invoice status: $INVOICE_NEW_STATUS (Expected: PARTIAL)"
echo "  Reconciliation: $RECONCILIATION"
```

**Validation:**
- ✅ Refund starts as PENDING
- ✅ Approval changes to APPROVED
- ✅ Payment marked as REFUNDED (is_refunded = TRUE)
- ✅ Invoice auto-recalculated: ₹10,000 - ₹5,000 refund = ₹5,000 collected → PARTIAL
- ✅ Audit trail has entries for: REFUND REQUEST, PERMISSION APPROVE, PAYMENT refund, INVOICE update

**Pass Criteria:** All state changes automatic and mathematically correct

---

### Test Scenario 6: Adjustment Rejection

**Objective:** Verify rejected adjustments don't affect invoice/payment state

**Execution:**
```bash
INVOICE_ID="inv-test-006"

# Setup: Create and verify full payment (PAID invoice)

# Request adjustment
ADJ_REQUEST=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "'$INVOICE_ID'",
    "type": "WRITE_OFF",
    "amount": 2000,
    "reason": "Resident dispute - requesting write-off"
  }')

ADJ_ID=$(echo $ADJ_REQUEST | jq -r '.data.adjustment.id')

# Get invoice status before rejection
INVOICE_BEFORE=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/invoices/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN" | jq -r '.data.status')
echo "Invoice status before rejection: $INVOICE_BEFORE"

# Reject adjustment
REJECT=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments/$ADJ_ID/reject \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Insufficient documentation provided. Please resubmit with proof."
  }')

ADJ_REJECTED_STATUS=$(echo $REJECT | jq -r '.data.status')
echo "Adjustment rejected: Status = $ADJ_REJECTED_STATUS"

# Get invoice status after rejection (should be unchanged)
INVOICE_AFTER=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/invoices/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN" | jq -r '.data.status')
echo "Invoice status after rejection: $INVOICE_AFTER"

if [ "$INVOICE_BEFORE" = "$INVOICE_AFTER" ] && [ "$ADJ_REJECTED_STATUS" = "REJECTED" ]; then
  echo "✅ REJECTION PASSED: Invoice unchanged, adjustment rejected"
else
  echo "❌ REJECTION FAILED: Invoice or adjustment state incorrect"
fi
```

**Validation:**
- ✅ Adjustment status: PENDING → REJECTED
- ✅ Invoice status unchanged (no impact)
- ✅ Payment status unchanged (no impact)
- ✅ Audit trail shows REJECT action with reason

---

### Test Scenario 7: Refund Reversal

**Objective:** Verify approved refunds can be reversed, restoring payment status

**Execution:**
```bash
INVOICE_ID="inv-test-007"

# Setup: Create PAID invoice, then approve refund
# (Result: Invoice = PARTIAL, Payment = REFUNDED)

# Get adjustment ID from pending list (or from previous approval)
ADJ_ID="adj-uuid-refunded"

# Reverse the refund
REVERSE=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments/$ADJ_ID/reverse \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Resident cancelled refund request"
  }')

ADJ_REVERSED=$(echo $REVERSE | jq -r '.data.adjustment.status')
PAYMENT_RESTORED=$(echo $REVERSE | jq -r '.data.paymentRestoration.new_status')
INVOICE_RESTORED=$(echo $REVERSE | jq -r '.data.invoiceStatusChange.new_status')

echo "After reversal:"
echo "  Adjustment: $ADJ_REVERSED (Expected: REVERSED)"
echo "  Payment: $PAYMENT_RESTORED (Expected: VERIFIED)"
echo "  Invoice: $INVOICE_RESTORED (Expected: PAID)"

# Verify can't reverse twice
REVERSE_AGAIN=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments/$ADJ_ID/reverse \
  -H "Authorization: Bearer $TEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Attempting double reversal"
  }')

ERROR=$(echo $REVERSE_AGAIN | jq -r '.message // .error')
echo "Double reversal attempt: $ERROR (Expected: Cannot reverse non-APPROVED adjustment)"
```

**Validation:**
- ✅ First reversal: APPROVED → REVERSED
- ✅ Payment restored: REFUNDED → VERIFIED
- ✅ Invoice restored: PARTIAL → PAID
- ✅ Second reversal rejected (already REVERSED)

---

### Test Scenario 8: Audit Trail Completeness

**Objective:** Verify all financial mutations are logged with complete context

**Setup:** Run Scenarios 1-7, then validate audit trail

**Execution:**
```bash
INVOICE_ID="inv-test-008"

# Get complete audit trail for invoice
AUDIT_TRAIL=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/reports/audit-trail/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN")

ENTRY_COUNT=$(echo $AUDIT_TRAIL | jq '.data | length')
echo "Audit trail entries: $ENTRY_COUNT"

# Extract and validate each entry
echo "$AUDIT_TRAIL" | jq '.data[] | {action, changedBy, changedAt, reason}' | head -20

# Verify structure of each entry
FIRST_ENTRY=$(echo $AUDIT_TRAIL | jq '.data[0]')
echo ""
echo "First entry validation:"
echo "  Has auditId: $(echo $FIRST_ENTRY | jq 'has("auditId")')"
echo "  Has action: $(echo $FIRST_ENTRY | jq 'has("action")')"
echo "  Has changedBy: $(echo $FIRST_ENTRY | jq 'has("changedBy")')"
echo "  Has changedAt: $(echo $FIRST_ENTRY | jq 'has("changedAt")')"
echo "  Has previousState: $(echo $FIRST_ENTRY | jq 'has("previousState")')"
echo "  Has newState: $(echo $FIRST_ENTRY | jq 'has("newState")')"
echo "  Has userRole: $(echo $FIRST_ENTRY | jq 'has("userRole")')"
echo "  Has ipAddress: $(echo $FIRST_ENTRY | jq 'has("ipAddress")')"

# Verify audit integrity
INTEGRITY=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/reports/audit-integrity/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN")

INTEGRITY_STATUS=$(echo $INTEGRITY | jq -r '.status')
echo ""
echo "Audit integrity: $INTEGRITY_STATUS (Expected: ok)"
if [ "$INTEGRITY_STATUS" != "ok" ]; then
  echo "Issues found: $(echo $INTEGRITY | jq '.message')"
fi
```

**Validation:**
- ✅ CREATE is first entry
- ✅ All timestamps in chronological order
- ✅ Every action has who (changedBy), what (action), when (changedAt), why (reason)
- ✅ State snapshots (previousState, newState) are complete
- ✅ IP address and role tracked for compliance

---

### Test Scenario 9: Reconciliation Accuracy

**Objective:** Validate reconciliation math for various payment scenarios

**Execution:**
```bash
INVOICE_ID="inv-test-009"
INVOICE_TOTAL=15000

# Create invoice for ₹15,000
# Make payments: ₹5,000, ₹7,000, ₹3,000 = ₹15,000 total

# Get reconciliation report
RECONCILIATION=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/payments/reconciliation/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN")

echo "Reconciliation Report:"
echo "====================="
echo "$RECONCILIATION" | jq '.data | {
  "invoiceTotal": .invoice.total,
  "payments": {
    "verified": .payments.VERIFIED,
    "pending": .payments.PENDING_VERIFICATION,
    "rejected": .payments.REJECTED
  },
  "summary": .summary
}' | head -30

# Manual validation
TOTAL_VERIFIED=$(echo $RECONCILIATION | jq '.data.summary.totalVerified')
REMAINING=$(echo $RECONCILIATION | jq '.data.summary.remainingBalance')
COLLECTION_PCT=$(echo $RECONCILIATION | jq '.data.summary.collectionPercentage')
RECON_STATUS=$(echo $RECONCILIATION | jq '.data.summary.reconciliationStatus')
IS_RECONCILED=$(echo $RECONCILIATION | jq '.data.isReconciled')

echo ""
echo "Validation:"
echo "  Total Verified: ₹$TOTAL_VERIFIED (Expected: $INVOICE_TOTAL)"
echo "  Remaining Balance: ₹$REMAINING (Expected: 0)"
echo "  Collection %: $COLLECTION_PCT (Expected: 100.00)"
echo "  Reconciliation Status: $RECON_STATUS (Expected: FULLY_PAID)"
echo "  Is Reconciled: $IS_RECONCILED (Expected: true)"

# Test with refunded payment
# (Create adjustment, approve refund)
# Then check reconciliation again

RECONCILIATION_POST_REFUND=$(curl -s -X GET http://localhost:5000/api/$TEST_ORG_ID/billing/payments/reconciliation/$INVOICE_ID \
  -H "Authorization: Bearer $TEST_TOKEN")

TOTAL_REFUNDED=$(echo $RECONCILIATION_POST_REFUND | jq '.data.summary.totalRefunded')
NET_COLLECTED=$(echo $RECONCILIATION_POST_REFUND | jq '.data.summary.netCollected')

echo ""
echo "Post-Refund Validation:"
echo "  Total Refunded: ₹$TOTAL_REFUNDED"
echo "  Net Collected: ₹$NET_COLLECTED (Should = Verified - Refunded)"
```

**Validation:**
- ✅ Sum of verified payments = invoice total
- ✅ Remaining balance correctly calculated
- ✅ Collection percentage = (verified / total) × 100
- ✅ Refunded amounts excluded from active collection
- ✅ Net collected = verified - refunded

---

### Test Scenario 10: Multi-Tenant Isolation

**Objective:** Verify data from one organization is invisible to another

**Execution:**
```bash
# Create two separate organizations
ORG_1="org-1-id"
ORG_2="org-2-id"

# Create invoice in ORG_1
INVOICE_1=$(curl -s -X POST http://localhost:5000/api/$ORG_1/billing/invoices \
  -H "Authorization: Bearer $TOKEN_1" \
  -H "Content-Type: application/json" \
  -d '{
    "person_id": "resident-1",
    "due_date": "2026-03-15",
    "items": [{"item_name": "Test", "quantity": 1, "unit_price": 1000}]
  }')

INVOICE_ID_1=$(echo $INVOICE_1 | jq -r '.data.invoice.id')
echo "Organization 1 - Invoice created: $INVOICE_ID_1"

# Try to access ORG_1 invoice from ORG_2
UNAUTHORIZED=$(curl -s -X GET http://localhost:5000/api/$ORG_2/billing/invoices/$INVOICE_ID_1 \
  -H "Authorization: Bearer $TOKEN_2")

ERROR=$(echo $UNAUTHORIZED | jq -r '.message // .error')
echo "Organization 2 accessing ORG_1 data: $ERROR"
# Expected: "Invoice not found" or 404

# Try to access ORG_1 analytics from ORG_2
ANALYTICS_UNAUTHORIZED=$(curl -s -X POST http://localhost:5000/api/$ORG_2/reports/revenue-overview \
  -H "Authorization: Bearer $TOKEN_2" \
  -H "Content-Type: application/json" \
  -d '{}')

LEADS_COUNT=$(echo $ANALYTICS_UNAUTHORIZED | jq '.data.summary | length')
echo "Organization 2 analytics shows ORG_1 data: $LEADS_COUNT entries"
# Expected: 0 (or only ORG_2 data)
```

**Validation:**
- ✅ ORG_1 data invisible to ORG_2
- ✅ ORG_2 data invisible to ORG_1
- ✅ Queries filtered by organization_id at database level

---

### Test Scenario 11: Permission Enforcement (ORG_ADMIN Only)

**Objective:** Verify only ORG_ADMIN can access reports and approve adjustments

**Setup:** Create users with different roles in same organization
- Admin user: ORG_ADMIN
- Staff user: ORG_USER

**Execution:**
```bash
# Attempt 1: ORG_USER tries to access reports
REPORTS_UNAUTHORIZED=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/reports/revenue-overview \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')

STATUS=$(echo $REPORTS_UNAUTHORIZED | jq -r '.status // "success"')
echo "Staff user accessing reports: Status = $STATUS (Expected: error or 403)"

# Attempt 2: ORG_USER tries to approve adjustment
APPROVE_UNAUTHORIZED=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments/$ADJ_ID/approve \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Unauthorized approval"}')

ERROR=$(echo $APPROVE_UNAUTHORIZED | jq -r '.message // .error')
echo "Staff user approving adjustment: $ERROR (Expected: Authorization error)"

# Attempt 3: ORG_ADMIN successfully approves
APPROVE_AUTHORIZED=$(curl -s -X POST http://localhost:5000/api/$TEST_ORG_ID/billing/adjustments/$ADJ_ID/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"notes": "Authorized approval"}')

SUCCESS=$(echo $APPROVE_AUTHORIZED | jq -r '.success')
echo "Admin user approving adjustment: Success = $SUCCESS"
```

**Validation:**
- ✅ ORG_ADMIN can access all endpoints
- ✅ ORG_USER gets 403 on admin-only endpoints
- ✅ Permission checked on: /adjustments/*/approve, /adjustments/*/reject, /reports/*

---

## 📊 VALIDATION SCORECARD

After running all test scenarios, fill in this scorecard:

```
TEST RESULTS SUMMARY
====================

Core Financial Flows:
[ ] Scenario 1: Full Payment Lifecycle ............... ✅ / ❌
[ ] Scenario 2: Partial Payment Transitions .......... ✅ / ❌
[ ] Scenario 3: Multiple Payments .................... ✅ / ❌
[ ] Scenario 4: Refund & Approval .................... ✅ / ❌

Edge Cases & Error Handling:
[ ] Scenario 5: Duplicate Webhook Idempotency ........ ✅ / ❌
[ ] Scenario 6: Overpayment Prevention ............... ✅ / ❌
[ ] Scenario 7: Invalid State Transitions ........... ✅ / ❌
[ ] Scenario 8: Adjustment Rejection .................. ✅ / ❌

Reconciliation & Integrity:
[ ] Scenario 9: Reconciliation Math .................. ✅ / ❌
[ ] Scenario 10: Payment Integrity Check ............ ✅ / ❌
[ ] Scenario 11: Refund Impact ........................ ✅ / ❌
[ ] Scenario 12: State Distribution .................. ✅ / ❌

Audit & Compliance:
[ ] Scenario 13: Complete Audit Trail ................ ✅ / ❌
[ ] Scenario 14: Audit Trail for Payments ........... ✅ / ❌
[ ] Scenario 15: Audit Trail Integrity .............. ✅ / ❌
[ ] Scenario 16: User Action Traceability ........... ✅ / ❌

Multi-Tenant & Security:
[ ] Scenario 17: Org Isolation ....................... ✅ / ❌
[ ] Scenario 18: Permission Enforcement ............. ✅ / ❌
[ ] Scenario 19: Concurrent Operations .............. ✅ / ❌

==========================================
OVERALL: ___/19 scenarios passed
Pass Rate: ___%
STATUS: [ ] PRODUCTION READY [ ] NEEDS FIXES
```

---

## 🚀 SUCCESS CRITERIA

**MUST PASS (100% required):**
1. ✅ All audit entries created for every financial mutation
2. ✅ Reconciliation math accurate to the penny
3. ✅ Idempotent webhook handling (no duplicates)
4. ✅ Overpayment prevention works
5. ✅ All state transitions validated
6. ✅ Multi-tenant isolation verified
7. ✅ Permission enforcement active
8. ✅ Refund reversal restores payment status correctly

**NICE TO HAVE (can iterate post-launch):**
- Performance metrics (response time < 200ms for 95th percentile)
- Concurrent payment processing (100+ simultaneous)
- Large-scale reconciliation (10,000+ invoices)

---

## 📝 EXECUTION NOTES

**Before Running Tests:**
1. Ensure database migrations are applied
2. Create test organizations and users
3. Clear test data between scenario runs (optional, can use different invoice/person IDs)
4. Capture TOKEN and ORG_ID from registration response
5. Monitor server logs for errors during execution

**How to Run:**
```bash
# Save this file as PRODUCTION_READINESS_TESTS.md
# Run each scenario in sequence, documenting results
# Use curl commands provided, substituting actual token/org_id values
# Compare actual results with expected results
# Document any deviations
```

**Troubleshooting:**
- If payment verification fails: Check that payment status is PENDING_VERIFICATION
- If invoice status doesn't update: Ensure payment verification completed successfully
- If audit trail missing entries: Check that audit service is enabled and database connection is active
- If reconciliation math wrong: Verify SUM() calculation includes both verified and refunded fields

---

## ✅ FINAL SIGN-OFF

**Production-Ready Checklist:**
- [ ] All 19 test scenarios pass
- [ ] Audit trail complete for all mutations
- [ ] Reconciliation accurate within tolerance
- [ ] Multi-tenant isolation verified
- [ ] No security vulnerabilities identified
- [ ] Performance acceptable (< 200ms response time)
- [ ] Documentation updated
- [ ] Team trained on procedures

**Approved for Pilot CA Deployment:**
- [ ] CTO/Technical Lead
- [ ] Finance/Product Owner
- [ ] Security/Compliance Officer

---

**Generated:** 2026-02-15
**For:** SAMA-SUITE Production Deployment
**Testing Framework:** Manual curl-based scenarios + automated assertions
**Target:** CA firms (2-3 pilots)

