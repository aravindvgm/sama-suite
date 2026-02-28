# API Examples & Test Cases

Complete examples for testing all implemented endpoints.

---

## 🔑 Authentication APIs

### 1. Register New User & Organization

**Endpoint:** `POST /api/auth/register`

**Request:**
```json
{
  "full_name": "Sarah Johnson",
  "email": "sarah@greenvalley.com",
  "password": "SecurePass123!",
  "organization_name": "Green Valley Apartments",
  "industry_type": "APARTMENT"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjNlNDU2Ny1lODliLTEyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJvcmdhbml6YXRpb25faWQiOiI5ODdmY2RlYi01MWEyLTQzYjgtOTAxMi0zNDU2Nzg5MDEyMzQiLCJvcmdSb2xlIjoiT1JHX0FETUlOIiwicGxhdGZvcm1Sb2xlIjoiVVNFUiIsImlhdCI6MTcwOTQ3NjgwMCwiZXhwIjoxNzA5NTYzMjAwfQ.xyz123abc456",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "full_name": "Sarah Johnson",
    "email": "sarah@greenvalley.com",
    "organization_id": "987fcdeb-51a2-43b8-9012-345678901234",
    "orgRole": "ORG_ADMIN"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "User already exists"
}
```

**Validation Errors:**
```json
// Missing full_name
{
  "success": false,
  "message": "Full name is required"
}

// Invalid industry_type
{
  "success": false,
  "message": "Invalid industry type"
}
```

**Valid Industry Types:**
- `SCHOOL`
- `APARTMENT`
- `GYM`
- `POS`
- `FINANCE`

---

### 2. Login

**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{
  "email": "sarah@greenvalley.com",
  "password": "SecurePass123!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjNlNDU2Ny1lODliLTEyZDMtYTQ1Ni00MjY2MTQxNzQwMDAiLCJvcmdhbml6YXRpb25faWQiOiI5ODdmY2RlYi01MWEyLTQzYjgtOTAxMi0zNDU2Nzg5MDEyMzQiLCJvcmdSb2xlIjoiT1JHX0FETUlOIiwicGxhdGZvcm1Sb2xlIjoiVVNFUiIsImlhdCI6MTcwOTQ3NjgwMCwiZXhwIjoxNzA5NTYzMjAwfQ.xyz123abc456",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "full_name": "Sarah Johnson",
    "email": "sarah@greenvalley.com",
    "organization_id": "987fcdeb-51a2-43b8-9012-345678901234",
    "orgRole": "ORG_ADMIN"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "Invalid credentials"
}
```

**⚠️ Important:** Save the `token` and `organization_id` for subsequent requests!

---

### 3. Get User Profile

**Endpoint:** `GET /api/auth/profile`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile accessed successfully",
  "user": {
    "user_id": "123e4567-e89b-12d3-a456-426614174000",
    "organization_id": "987fcdeb-51a2-43b8-9012-345678901234",
    "platform_role": "USER",
    "org_role": "ORG_ADMIN"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

---

## 💰 Billing APIs

### 4. Create Invoice

**Endpoint:** `POST /api/:organizationId/billing/invoices`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request:**
```json
{
  "person_id": "resident-uuid-12345",
  "due_date": "2026-03-15",
  "notes": "Monthly maintenance for February 2026",
  "items": [
    {
      "item_name": "Monthly Maintenance",
      "quantity": 1,
      "unit_price": 3500
    },
    {
      "item_name": "Water Charges",
      "quantity": 1,
      "unit_price": 500
    },
    {
      "item_name": "Parking Fee",
      "quantity": 2,
      "unit_price": 250
    }
  ]
}
```

**Success Response (201):**
```json
{
  "success": true,
  "data": {
    "success": true,
    "invoice": {
      "id": "inv-uuid-7890abcd",
      "invoice_number": "INV-7890ABCD",
      "total_amount": 4500,
      "status": "DRAFT"
    }
  }
}
```

**Calculation:**
```
Monthly Maintenance: 1 × ₹3,500 = ₹3,500
Water Charges:       1 × ₹500   = ₹500
Parking Fee:         2 × ₹250   = ₹500
                              ─────────
                    Total:      ₹4,500
```

**Error Responses:**
```json
// Missing person_id
{
  "success": false,
  "message": "person_id is required"
}

// Missing items
{
  "success": false,
  "message": "At least one invoice item is required"
}

// Invalid quantity
{
  "success": false,
  "message": "Quantity must be greater than 0"
}

// Invalid date
{
  "success": false,
  "message": "Invalid due_date"
}
```

---

### 5. Get Invoice Details

**Endpoint:** `GET /api/:organizationId/billing/invoices/:invoiceId`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**URL Example:**
```
GET /api/987fcdeb-51a2-43b8-9012-345678901234/billing/invoices/inv-uuid-7890abcd
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "inv-uuid-7890abcd",
    "organization_id": "987fcdeb-51a2-43b8-9012-345678901234",
    "person_id": "resident-uuid-12345",
    "invoice_number": "INV-7890ABCD",
    "total_amount": 4500,
    "due_date": "2026-03-15T00:00:00.000Z",
    "status": "DRAFT",
    "notes": "Monthly maintenance for February 2026",
    "created_at": "2026-02-15T10:30:00.000Z",
    "updated_at": "2026-02-15T10:30:00.000Z",
    "items": [
      {
        "id": "item-uuid-1",
        "item_name": "Monthly Maintenance",
        "quantity": 1,
        "unit_price": 3500,
        "total_amount": 3500
      },
      {
        "id": "item-uuid-2",
        "item_name": "Water Charges",
        "quantity": 1,
        "unit_price": 500,
        "total_amount": 500
      },
      {
        "id": "item-uuid-3",
        "item_name": "Parking Fee",
        "quantity": 2,
        "unit_price": 250,
        "total_amount": 500
      }
    ]
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Invoice not found"
}
```

---

### 6. Send Invoice to Resident

**Endpoint:** `POST /api/:organizationId/billing/invoices/:invoiceId/send`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Request Body:** (Can be empty or include notification preferences)
```json
{
  "send_email": true,
  "send_sms": false
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Invoice sent successfully",
  "data": {
    "invoice_id": "inv-uuid-7890abcd",
    "status": "SENT",
    "sent_at": "2026-02-15T11:00:00.000Z"
  }
}
```

---

### 7. Create Payment Record

**Endpoint:** `POST /api/:organizationId/billing/payments`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request:**
```json
{
  "invoice_id": "inv-uuid-7890abcd",
  "amount": 4500,
  "payment_method": "UPI",
  "transaction_id": "TXN123456789",
  "payment_date": "2026-02-16",
  "notes": "Paid via Google Pay",
  "proof_url": "https://storage.example.com/payment-screenshots/abc123.jpg"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "data": {
    "payment_id": "pay-uuid-xyz789",
    "invoice_id": "inv-uuid-7890abcd",
    "amount": 4500,
    "status": "PENDING_VERIFICATION",
    "created_at": "2026-02-16T09:30:00.000Z"
  }
}
```

---

### 8. Verify Payment (Admin Only)

**Endpoint:** `POST /api/:organizationId/billing/payments/:paymentId/verify`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request:**
```json
{
  "notes": "Payment verified, screenshot matches bank statement"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Payment verified successfully",
  "data": {
    "payment_id": "pay-uuid-xyz789",
    "status": "VERIFIED",
    "verified_at": "2026-02-16T14:00:00.000Z",
    "verified_by": "123e4567-e89b-12d3-a456-426614174000",
    "invoice_status": "PAID"
  }
}
```

---

### 9. Reject Payment (Admin Only)

**Endpoint:** `POST /api/:organizationId/billing/payments/:paymentId/reject`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request:**
```json
{
  "reason": "Payment screenshot is unclear, please resubmit with clear image"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Payment rejected",
  "data": {
    "payment_id": "pay-uuid-xyz789",
    "status": "REJECTED",
    "rejected_at": "2026-02-16T14:30:00.000Z",
    "rejected_by": "123e4567-e89b-12d3-a456-426614174000",
    "reason": "Payment screenshot is unclear, please resubmit with clear image"
  }
}
```

---

## 💳 Payment Reconciliation & Integrity

### Payment Idempotency Guarantee

**Problem:** Webhook retries can cause duplicate payment marking

**Solution:** `external_payment_id` uniqueness constraint at database level

**Example: Webhook Retry (Same Request Twice)**
```bash
# First attempt
curl -X POST http://localhost:5000/api/org-id/billing/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{
    "invoice_id": "inv-uuid-123",
    "amount": 5000,
    "payment_method": "UPI",
    "external_payment_id": "UPI-TXN-20260215-001",
    "payment_date": "2026-02-16"
  }'

# Response - CREATED (201)
{
  "success": true,
  "data": {
    "isNew": true,
    "payment": {
      "id": "pay-uuid-001",
      "status": "PENDING_VERIFICATION",
      "amount": 5000
    }
  }
}

# Second attempt (Webhook retry - Same external_payment_id)
# EXACT SAME REQUEST

# Response - SUCCESS with isNew: false (idempotent)
{
  "success": true,
  "data": {
    "isNew": false,
    "payment": {
      "id": "pay-uuid-001",  # SAME payment ID
      "status": "PENDING_VERIFICATION",
      "amount": 5000
    },
    "message": "Payment with external ID UPI-TXN-20260215-001 already exists (idempotent)"
  }
}
```

**Result:** Only ONE payment record created for both webhook calls.

---

### Get Invoice Reconciliation

**Endpoint:** `GET /api/:organizationId/billing/payments/reconciliation/:invoiceId`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "inv-uuid-123",
      "total": 10000,
      "status": "PAID"
    },
    "payments": {
      "VERIFIED": {
        "count": 2,
        "activeAmount": 10000,
        "refundedAmount": 0
      },
      "PENDING_VERIFICATION": {
        "count": 0,
        "activeAmount": 0,
        "refundedAmount": 0
      },
      "REJECTED": {
        "count": 1,
        "activeAmount": 0,
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
}
```

---

### Verify Payment Integrity

**Endpoint:** `GET /api/:organizationId/billing/payments/integrity/:externalPaymentId`

Detects if duplicate verified payments exist with same external ID:

**Success Response (200):**
```json
{
  "status": "ok",
  "message": "No duplicates detected"
}
```

**Error Response (If Duplicates Found):**
```json
{
  "status": "error",
  "message": "CRITICAL: Multiple verified payments for same external ID",
  "duplicateCount": 2
}
```

---

## 🔧 Adjustments & Refund Workflow

### Request Adjustment (Refund/Write-off/Credit Note)

**Endpoint:** `POST /api/:organizationId/billing/adjustments`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request - Refund (PENDING APPROVAL):**
```json
{
  "invoiceId": "inv-uuid-123",
  "type": "REFUND",
  "amount": 5000,
  "reason": "Resident requested refund due to overpayment",
  "paymentId": "pay-uuid-001",
  "metadata": {
    "refundMethod": "UPI_REVERSE",
    "originalPaymentRef": "UPI-TXN-123"
  }
}
```

**Request - Write-off (PENDING APPROVAL):**
```json
{
  "invoiceId": "inv-uuid-456",
  "type": "WRITE_OFF",
  "amount": 2000,
  "reason": "Resident vacancy - write off unpaid maintenance",
  "metadata": {
    "approvalCode": "WO-FEB-2026",
    "approvedBy": "finance_team"
  }
}
```

**Request - Credit Note:**
```json
{
  "invoiceId": "inv-uuid-789",
  "type": "CREDIT_NOTE",
  "amount": 1500,
  "reason": "Service charge correction - overpaid amount",
  "metadata": {
    "creditNoteNumber": "CN-2026-001"
  }
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Adjustment requested and awaiting approval",
  "data": {
    "adjustment": {
      "id": "adj-uuid-001",
      "invoice_id": "inv-uuid-123",
      "type": "REFUND",
      "amount": 5000,
      "status": "PENDING",
      "requested_by": "user-uuid-123",
      "requested_at": "2026-02-15T10:30:00.000Z",
      "reason": "Resident requested refund due to overpayment"
    }
  }
}
```

---

### Approve Adjustment (Admin Only)

**Endpoint:** `POST /api/:organizationId/billing/adjustments/:adjustmentId/approve`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request:**
```json
{
  "notes": "Verified resident documentation. Refunding via original UPI method."
}
```

**Success Response (200) - For REFUND:**
```json
{
  "success": true,
  "message": "Adjustment approved",
  "data": {
    "adjustment": {
      "id": "adj-uuid-001",
      "status": "APPROVED",
      "approved_by": "admin-user-123",
      "approved_at": "2026-02-15T11:00:00.000Z",
      "type": "REFUND",
      "amount": 5000
    },
    "paymentImpact": {
      "payment_id": "pay-uuid-001",
      "previous_status": "VERIFIED",
      "new_status": "REFUNDED",
      "refunded_amount": 5000
    },
    "invoiceStatusChange": {
      "previous_status": "PAID",
      "new_status": "PARTIAL",
      "remaining_balance": 5000,
      "reason": "Auto-recalculated after refund approval"
    },
    "reconciliation": {
      "totalVerified": 5000,
      "totalRefunded": 5000,
      "netCollected": 0,
      "collectionPercentage": "50.00"
    }
  }
}
```

**Success Response (200) - For WRITE_OFF:**
```json
{
  "success": true,
  "message": "Adjustment approved",
  "data": {
    "adjustment": {
      "id": "adj-uuid-002",
      "status": "APPROVED",
      "type": "WRITE_OFF",
      "amount": 2000
    },
    "invoiceStatusChange": {
      "previous_status": "PENDING",
      "new_status": "WRITTEN_OFF",
      "reason": "Write-off adjustment applied"
    }
  }
}
```

---

### Reject Adjustment (Admin Only)

**Endpoint:** `POST /api/:organizationId/billing/adjustments/:adjustmentId/reject`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request - MANDATORY REASON:**
```json
{
  "reason": "Resident does not have documentation for claimed overpayment. Please resubmit with proof."
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Adjustment rejected",
  "data": {
    "id": "adj-uuid-001",
    "status": "REJECTED",
    "rejected_by": "admin-user-123",
    "rejected_at": "2026-02-15T11:30:00.000Z",
    "rejection_reason": "Resident does not have documentation for claimed overpayment. Please resubmit with proof."
  }
}
```

**Note:** Invoice status is NOT changed. Adjustment had no effect.

---

### Reverse Approved Adjustment (Admin Only)

**Endpoint:** `POST /api/:organizationId/billing/adjustments/:adjustmentId/reverse`

Only works on APPROVED adjustments. Reverses the adjustment and restores previous state.

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request - MANDATORY REASON:**
```json
{
  "reason": "Refund was processed but resident requested reversal. Maintaining original payment."
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Adjustment reversed",
  "data": {
    "adjustment": {
      "id": "adj-uuid-001",
      "status": "REVERSED",
      "reversed_by": "admin-user-123",
      "reversed_at": "2026-02-15T12:00:00.000Z",
      "reversal_reason": "Refund was processed but resident requested reversal. Maintaining original payment."
    },
    "paymentRestoration": {
      "payment_id": "pay-uuid-001",
      "previous_status": "REFUNDED",
      "new_status": "VERIFIED",
      "restored_amount": 5000
    },
    "invoiceStatusChange": {
      "previous_status": "PARTIAL",
      "new_status": "PAID",
      "reason": "Auto-recalculated after refund reversal"
    }
  }
}
```

---

### Get Invoice Adjustments

**Endpoint:** `GET /api/:organizationId/billing/adjustments/invoice/:invoiceId`

Complete history of all refunds, write-offs, reversals for an invoice.

**Success Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "adj-uuid-001",
      "invoice_id": "inv-uuid-123",
      "type": "REFUND",
      "amount": 5000,
      "status": "APPROVED",
      "requested_by": "user-123",
      "requested_at": "2026-02-15T10:30:00.000Z",
      "approved_by": "admin-123",
      "approved_at": "2026-02-15T11:00:00.000Z",
      "reason": "Resident requested refund due to overpayment"
    },
    {
      "id": "adj-uuid-002",
      "invoice_id": "inv-uuid-123",
      "type": "WRITE_OFF",
      "amount": 2000,
      "status": "PENDING",
      "requested_at": "2026-02-15T14:00:00.000Z",
      "reason": "Service charge correction"
    }
  ],
  "count": 2
}
```

---

### Get Pending Adjustments (Admin Dashboard)

**Endpoint:** `GET /api/:organizationId/billing/adjustments/pending`

Shows all PENDING adjustments awaiting admin approval.

**Success Response (200):**
```json
{
  "success": true,
  "message": "3 adjustments pending approval",
  "data": [
    {
      "id": "adj-uuid-002",
      "invoice_id": "inv-uuid-456",
      "type": "WRITE_OFF",
      "amount": 2000,
      "requested_by": "user-456",
      "requested_at": "2026-02-15T14:00:00.000Z",
      "reason": "Resident vacancy - write off unpaid maintenance"
    },
    {
      "id": "adj-uuid-003",
      "invoice_id": "inv-uuid-789",
      "type": "CREDIT_NOTE",
      "amount": 1500,
      "requested_by": "user-789",
      "requested_at": "2026-02-15T15:00:00.000Z",
      "reason": "Service charge correction"
    },
    {
      "id": "adj-uuid-004",
      "invoice_id": "inv-uuid-101",
      "type": "REFUND",
      "amount": 3000,
      "requested_by": "user-101",
      "requested_at": "2026-02-15T15:30:00.000Z",
      "reason": "Double payment detected"
    }
  ],
  "count": 3
}
```

---

## 📋 Audit Trail & Compliance

### Get Audit Trail for Entity

**Endpoint:** `GET /api/:organizationId/reports/audit-trail/:entityId`

Complete history of all changes to an invoice, payment, or adjustment.

**Success Response (200):**
```json
{
  "success": true,
  "message": "Audit trail retrieved",
  "data": [
    {
      "auditId": "audit-001",
      "entityType": "INVOICE",
      "action": "CREATE",
      "changedBy": "user-123",
      "userRole": "ORG_ADMIN",
      "changedAt": "2026-02-15T10:00:00.000Z",
      "previousState": null,
      "newState": {
        "id": "inv-uuid-123",
        "status": "DRAFT",
        "total_amount": 10000
      },
      "reason": null,
      "ipAddress": "192.168.1.100"
    },
    {
      "auditId": "audit-002",
      "entityType": "INVOICE",
      "action": "SEND",
      "changedBy": "user-123",
      "userRole": "ORG_ADMIN",
      "changedAt": "2026-02-15T10:15:00.000Z",
      "previousState": {
        "status": "DRAFT"
      },
      "newState": {
        "status": "SENT"
      },
      "reason": "Invoice sent to resident",
      "ipAddress": "192.168.1.100"
    },
    {
      "auditId": "audit-003",
      "entityType": "PAYMENT",
      "action": "CREATE",
      "changedBy": "system",
      "userRole": "SYSTEM",
      "changedAt": "2026-02-15T10:30:00.000Z",
      "previousState": null,
      "newState": {
        "id": "pay-uuid-001",
        "status": "PENDING_VERIFICATION",
        "amount": 10000
      },
      "reason": null,
      "ipAddress": "0.0.0.0"
    },
    {
      "auditId": "audit-004",
      "entityType": "PAYMENT",
      "action": "VERIFY",
      "changedBy": "user-123",
      "userRole": "ORG_ADMIN",
      "changedAt": "2026-02-15T11:00:00.000Z",
      "previousState": {
        "status": "PENDING_VERIFICATION"
      },
      "newState": {
        "status": "VERIFIED",
        "verified_at": "2026-02-15T11:00:00.000Z"
      },
      "reason": "Payment verified",
      "ipAddress": "192.168.1.100"
    },
    {
      "auditId": "audit-005",
      "entityType": "INVOICE",
      "action": "UPDATE",
      "changedBy": "system",
      "userRole": "SYSTEM",
      "changedAt": "2026-02-15T11:00:00.000Z",
      "previousState": {
        "status": "SENT"
      },
      "newState": {
        "status": "PAID"
      },
      "reason": "Auto-updated on payment verification. Collected: ₹10000 / ₹10000",
      "ipAddress": "0.0.0.0"
    }
  ]
}
```

---

### Verify Audit Integrity

**Endpoint:** `GET /api/:organizationId/reports/audit-integrity/:entityId`

Checks for tampering, missing entries, timestamp anomalies.

**Success Response (200) - OK:**
```json
{
  "status": "ok",
  "message": "Audit trail integrity verified",
  "entryCount": 5,
  "firstEntry": "2026-02-15T10:00:00.000Z",
  "lastEntry": "2026-02-15T11:00:00.000Z"
}
```

**Error Response (200) - Issues Found:**
```json
{
  "status": "error",
  "message": "Audit trail timestamp sequence invalid",
  "details": {
    "previousEntry": {
      "action": "VERIFY",
      "changedAt": "2026-02-15T11:30:00.000Z"
    },
    "currentEntry": {
      "action": "CREATE",
      "changedAt": "2026-02-15T11:00:00.000Z"
    }
  }
}
```

---

## 📊 Revenue Analytics & Reporting APIs

**⚠️ Important:** All analytics endpoints require `ORG_ADMIN` role. Regular organization users (ORG_USER, ORG_MANAGER) will receive 403 Forbidden.

### 10. Revenue Overview Dashboard

**Endpoint:** `POST /api/:organizationId/reports/revenue-overview`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json
```

**Request (Optional Filters):**
```json
{
  "startDate": "2025-01-01",
  "endDate": "2026-02-15"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Revenue overview retrieved successfully",
  "data": {
    "period": {
      "startDate": "2025-01-01",
      "endDate": "2026-02-15"
    },
    "summary": {
      "totalRevenue": 450000,
      "invoiceCount": 25,
      "avgInvoiceValue": 18000,
      "growthRatePercentage": 12.5
    },
    "monthlyBreakdown": [
      {
        "month": "2026-02-01",
        "revenue": 45000,
        "invoiceCount": 3
      },
      {
        "month": "2026-01-01",
        "revenue": 42000,
        "invoiceCount": 3
      }
    ],
    "metadata": {
      "generatedAt": "2026-02-15T15:30:00.000Z",
      "currency": "INR"
    }
  }
}
```

---

### 11. Invoice Aging Report

**Endpoint:** `POST /api/:organizationId/reports/invoice-aging`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Invoice aging report retrieved successfully",
  "data": {
    "agingBrackets": {
      "0-30days": {
        "count": 5,
        "amount": 25000
      },
      "30-60days": {
        "count": 3,
        "amount": 18000
      },
      "60-90days": {
        "count": 2,
        "amount": 12000
      },
      "90+days": {
        "count": 1,
        "amount": 8000
      }
    },
    "totalOutstanding": 63000,
    "totalInvoices": 11,
    "metadata": {
      "generatedAt": "2026-02-15T15:30:00.000Z",
      "currency": "INR"
    }
  }
}
```

---

### 12. Collection Rate Metrics

**Endpoint:** `POST /api/:organizationId/reports/collection-metrics`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Query Parameters (Optional):**
```
?period=all|monthly|quarterly|yearly (default: all)
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Collection rate metrics retrieved successfully",
  "data": {
    "period": "all",
    "collectionRatePercentage": 87.5,
    "avgDaysToCollect": 12,
    "collectedAmount": 350000,
    "outstandingAmount": 50000,
    "partialAmount": 8000,
    "totalInvoices": 30,
    "metadata": {
      "generatedAt": "2026-02-15T15:30:00.000Z",
      "currency": "INR"
    }
  }
}
```

**Interpretation:**
- `87.5%` - Of the total amount, 87.5% has been collected
- `12` - Average days from invoice creation to payment
- Outstanding + Partial = Amount still owed

---

### 13. Payment Status Distribution

**Endpoint:** `POST /api/:organizationId/reports/payment-distribution`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Payment status distribution retrieved successfully",
  "data": {
    "statusBreakdown": {
      "PAID": {
        "count": 18,
        "amount": 350000
      },
      "PARTIAL": {
        "count": 3,
        "amount": 8000
      },
      "PENDING": {
        "count": 5,
        "amount": 25000
      },
      "OVERDUE": {
        "count": 2,
        "amount": 12000
      },
      "SENT": {
        "count": 1,
        "amount": 5000
      },
      "DRAFT": {
        "count": 2,
        "amount": 10000
      },
      "CANCELLED": {
        "count": 0,
        "amount": 0
      }
    },
    "summary": {
      "totalAmount": 410000,
      "totalInvoices": 31
    },
    "metadata": {
      "generatedAt": "2026-02-15T15:30:00.000Z",
      "currency": "INR"
    }
  }
}
```

---

### 14. Monthly Trends

**Endpoint:** `POST /api/:organizationId/reports/monthly-trends`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Query Parameters (Optional):**
```
?months=12 (default: 12, max: 36)
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Monthly trends retrieved successfully",
  "data": {
    "period": "Last 12 months",
    "trends": [
      {
        "month": "2026-02-01",
        "revenue": 45000,
        "invoiceCount": 3,
        "collectedAmount": 42000,
        "collectionRatePercentage": 93.33
      },
      {
        "month": "2026-01-01",
        "revenue": 42000,
        "invoiceCount": 3,
        "collectedAmount": 38000,
        "collectionRatePercentage": 90.48
      },
      {
        "month": "2025-12-01",
        "revenue": 38000,
        "invoiceCount": 2,
        "collectedAmount": 35000,
        "collectionRatePercentage": 92.11
      }
    ],
    "summary": {
      "totalRevenue": 450000,
      "totalInvoices": 45,
      "averageCollectionRate": 89.75
    },
    "metadata": {
      "generatedAt": "2026-02-15T15:30:00.000Z",
      "currency": "INR"
    }
  }
}
```

---

### 15. Resident Summary (Drill-down)

**Endpoint:** `POST /api/:organizationId/reports/resident-summary`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Query Parameters (Optional):**
```
?limit=50 (default: 50, max: 1000)
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Resident summary retrieved successfully",
  "data": {
    "residents": [
      {
        "personId": "resident-001",
        "invoiceCount": 8,
        "totalAmount": 28000,
        "collectedAmount": 25000,
        "outstandingAmount": 3000,
        "collectionRatePercentage": 89.29
      },
      {
        "personId": "resident-002",
        "invoiceCount": 7,
        "totalAmount": 26000,
        "collectedAmount": 22000,
        "outstandingAmount": 4000,
        "collectionRatePercentage": 84.62
      }
    ],
    "summary": {
      "totalResidents": 2,
      "totalOutstanding": 7000,
      "averageCollectionRate": 86.95
    },
    "metadata": {
      "generatedAt": "2026-02-15T15:30:00.000Z",
      "currency": "INR"
    }
  }
}
```

---

### 16. Export Analytics Data

**Endpoint:** `POST /api/:organizationId/reports/export`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Query Parameters:**
```
?format=json|csv (default: json)
&reportType=summary|revenue|aging|collection|status|trends (default: summary)
&startDate=2025-01-01
&endDate=2026-02-15
```

**JSON Export Response (200):**
```json
{
  "success": true,
  "message": "Report exported successfully",
  "data": {
    "revenue": { ... },
    "aging": { ... },
    "collection": { ... },
    "status": { ... },
    "trends": [ ... ]
  },
  "metadata": {
    "reportType": "summary",
    "generatedAt": "2026-02-15T15:30:00.000Z",
    "currency": "INR"
  }
}
```

**CSV Export Response (200):**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="analytics_summary_2026-02-15.csv"

Report Summary

Revenue Overview
Month,Revenue,Invoice Count
2026-02-01,45000,3
2026-01-01,42000,3

Invoice Aging
Age Bracket,Count,Amount
0-30days,5,25000
30-60days,3,18000
...
```

**Supported Report Types:**
- `summary` - All metrics in one export
- `revenue` - Revenue overview with monthly breakdown
- `aging` - Invoice aging brackets
- `collection` - Collection rate metrics
- `status` - Payment status distribution
- `trends` - Monthly trends

---

## 🧪 Complete Test Scenario

### Step-by-Step Testing Flow:

#### Step 1: Register Organization
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Test Admin",
    "email": "admin@testcompany.com",
    "password": "Test@1234",
    "organization_name": "Test Apartments",
    "industry_type": "APARTMENT"
  }'
```

**Save from response:** `token` and `organization_id`

---

#### Step 2: Create Invoice
```bash
curl -X POST http://localhost:5000/api/987fcdeb-51a2-43b8-9012-345678901234/billing/invoices \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "person_id": "test-resident-123",
    "due_date": "2026-03-15",
    "notes": "Test invoice",
    "items": [
      {
        "item_name": "Maintenance",
        "quantity": 1,
        "unit_price": 5000
      }
    ]
  }'
```

**Save from response:** `invoice_id`

---

#### Step 3: Get Invoice Details
```bash
curl -X GET http://localhost:5000/api/987fcdeb-51a2-43b8-9012-345678901234/billing/invoices/YOUR_INVOICE_ID \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

---

#### Step 4: Send Invoice
```bash
curl -X POST http://localhost:5000/api/987fcdeb-51a2-43b8-9012-345678901234/billing/invoices/YOUR_INVOICE_ID/send \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

---

#### Step 5: Create Payment
```bash
curl -X POST http://localhost:5000/api/987fcdeb-51a2-43b8-9012-345678901234/billing/payments \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "invoice_id": "YOUR_INVOICE_ID",
    "amount": 5000,
    "payment_method": "UPI",
    "transaction_id": "TEST123456",
    "payment_date": "2026-02-16",
    "notes": "Test payment"
  }'
```

**Save from response:** `payment_id`

---

#### Step 6: Verify Payment
```bash
curl -X POST http://localhost:5000/api/987fcdeb-51a2-43b8-9012-345678901234/billing/payments/YOUR_PAYMENT_ID/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "notes": "Verified successfully"
  }'
```

---

## 📊 Sample Data for Testing

### Test Users:
```json
[
  {
    "full_name": "Admin User",
    "email": "admin@apartment.com",
    "password": "Admin@123",
    "organization_name": "Sunrise Apartments",
    "industry_type": "APARTMENT"
  },
  {
    "full_name": "School Principal",
    "email": "principal@school.com",
    "password": "School@123",
    "organization_name": "ABC International School",
    "industry_type": "SCHOOL"
  },
  {
    "full_name": "Gym Owner",
    "email": "owner@gym.com",
    "password": "Gym@123",
    "organization_name": "FitPro Gym",
    "industry_type": "GYM"
  }
]
```

### Test Invoices:
```json
[
  {
    "person_id": "resident-001",
    "due_date": "2026-03-01",
    "notes": "Monthly maintenance - March 2026",
    "items": [
      {"item_name": "Maintenance", "quantity": 1, "unit_price": 3500},
      {"item_name": "Water", "quantity": 1, "unit_price": 400}
    ]
  },
  {
    "person_id": "student-001",
    "due_date": "2026-04-01",
    "notes": "School fees - Term 1",
    "items": [
      {"item_name": "Tuition Fee", "quantity": 1, "unit_price": 15000},
      {"item_name": "Library Fee", "quantity": 1, "unit_price": 500},
      {"item_name": "Sports Fee", "quantity": 1, "unit_price": 1000}
    ]
  }
]
```

---

## 🚨 Common Error Codes

| Status Code | Meaning | Possible Causes |
|-------------|---------|-----------------|
| 400 | Bad Request | Missing required fields, invalid data format |
| 401 | Unauthorized | Missing token, invalid token, expired token |
| 403 | Forbidden | User doesn't have permission for this action |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Database error, server configuration issue |

---

## 💡 Tips for Frontend Integration

### 1. Store Token Securely
```javascript
// After login success
localStorage.setItem('authToken', response.token);
localStorage.setItem('organizationId', response.user.organization_id);
```

### 2. Add Token to All Requests
```javascript
const token = localStorage.getItem('authToken');

fetch('http://localhost:5000/api/auth/profile', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

### 3. Handle Token Expiration
```javascript
// If you get 401 response
if (response.status === 401) {
  // Clear token and redirect to login
  localStorage.removeItem('authToken');
  window.location.href = '/login';
}
```

### 4. Format Amounts
```javascript
// Display currency
const amount = 4500;
const formatted = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR'
}).format(amount);
// Output: ₹4,500.00
```

### 5. Format Dates
```javascript
// Display dates
const date = new Date('2026-03-15T00:00:00.000Z');
const formatted = date.toLocaleDateString('en-IN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});
// Output: March 15, 2026
```

---

## 🔗 UPI Payment Link Format

When you get invoice details for a resident, the UPI link looks like:
```
upi://pay?pa=apartmentname@upi&am=4500&cu=INR&tn=Maintenance%20Flat%20101&tr=INV-7890ABCD
```

**Parameters:**
- `pa` → Payee UPI ID (organization's UPI)
- `am` → Amount
- `cu` → Currency (INR)
- `tn` → Transaction Note (description)
- `tr` → Transaction Reference (invoice number)

**In UI:**
Show this as a button that opens UPI apps when clicked on mobile devices.

---

**Happy Testing! 🚀**

For UI/UX guidelines, see [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
For detailed documentation, see [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md)
