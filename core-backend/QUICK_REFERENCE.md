# Quick Reference Guide for UI/UX Designers

## 🎯 What This Backend Does (In Simple Terms)

This is a **multi-organization platform** that helps businesses manage their operations. Think of it like this:
- **One backend** serves many companies
- Each company has their own **separate data**
- Users belong to specific companies
- Two main features built so far: **Authentication** and **Billing**

---

## 🔑 Module 1: Authentication (User Accounts)

### What Can Users Do?

| Action | Who Can Do It | What Happens |
|--------|---------------|--------------|
| Sign Up | Anyone | Creates account + new organization |
| Login | Registered users | Gets access token to use the app |
| View Profile | Logged-in users | See their account details |
| Access Admin Panel | Admin users only | Manage the platform/organization |

### Sign Up Form Fields (UI Design):
```
┌─────────────────────────────────┐
│  Full Name:    [____________]   │
│  Email:        [____________]   │
│  Password:     [____________]   │
│  Company Name: [____________]   │
│  Business Type: [▼ Dropdown ]   │
│                                 │
│  Dropdown Options:              │
│  • School                       │
│  • Apartment                    │
│  • Gym                          │
│  • POS (Point of Sale)          │
│  • Finance                      │
│                                 │
│       [Sign Up Button]          │
└─────────────────────────────────┘
```

### Login Form Fields (UI Design):
```
┌─────────────────────────────────┐
│  Email:    [________________]   │
│  Password: [________________]   │
│                                 │
│       [Login Button]            │
└─────────────────────────────────┘
```

### What Happens After Login?
You get a **token** (like a digital key) that must be saved and sent with every request to access protected features.

---

## 💰 Module 2: Billing (Invoices & Payments)

### What Can Users Do?

**For Admins:**
- Create invoices for residents/customers
- Send invoices
- View all invoices
- Verify payments
- Generate reports

**For Residents/Customers:**
- View their pending invoices
- See payment links (UPI)
- Pay via UPI apps (Google Pay, PhonePe, etc.)
- Track payment history

### Invoice Creation Form (UI Design):
```
┌─────────────────────────────────────────┐
│ Select Customer: [▼ Dropdown     ]     │
│ Due Date:        [📅 Date Picker  ]     │
│                                         │
│ Invoice Items:                          │
│ ┌─────────────────────────────────────┐ │
│ │ Item 1: [Description    ]           │ │
│ │ Qty:    [__] Price: [_____]         │ │
│ │ Total: ₹1000              [Remove]  │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [+ Add Another Item]                    │
│                                         │
│ Notes: [___________________________]    │
│                                         │
│ Total Amount: ₹4000                     │
│                                         │
│ [Save as Draft] [Send Invoice]          │
└─────────────────────────────────────────┘
```

### Resident Invoice View (UI Design):
```
┌─────────────────────────────────────────┐
│ 📋 My Invoices                          │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Invoice #INV-ABC12345               │ │
│ │ Amount: ₹4000                       │ │
│ │ Due Date: Mar 15, 2026              │ │
│ │ Status: 🔴 Pending                  │ │
│ │                                     │ │
│ │ [💳 Pay with UPI]   [View Details] │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │ Invoice #INV-XYZ67890               │ │
│ │ Amount: ₹3500                       │ │
│ │ Due Date: Feb 15, 2026              │ │
│ │ Status: ✅ Paid                     │ │
│ │                                     │ │
│ │           [View Receipt]            │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### Payment Flow (UPI):
```
1. Resident clicks "Pay with UPI"
   ↓
2. UPI apps open (Google Pay, PhonePe, etc.)
   ↓
3. Payment details auto-filled:
   • Amount
   • Organization UPI ID
   • Invoice number as reference
   ↓
4. Resident completes payment
   ↓
5. Resident uploads payment screenshot
   ↓
6. Admin verifies payment
   ↓
7. Invoice marked as PAID ✅
```

---

## 🎨 Invoice Status Colors (For UI Design)

Use these status indicators in your designs:

| Status | Color | Icon | Meaning |
|--------|-------|------|---------|
| DRAFT | 🔵 Blue | 📝 | Invoice created, not sent yet |
| SENT | 🟡 Yellow | 📧 | Invoice sent to customer |
| PENDING | 🟠 Orange | ⏳ | Awaiting payment |
| PARTIAL | 🟣 Purple | 💰 | Partially paid |
| PAID | 🟢 Green | ✅ | Fully paid |
| OVERDUE | 🔴 Red | ⚠️ | Past due date |
| CANCELLED | ⚫ Gray | ❌ | Invoice cancelled |

---

## 🔐 User Roles (For Access Control in UI)

### Platform Roles (Global Level):
- **SUPER_ADMIN** → Can manage entire platform, all organizations
- **USER** → Regular user

### Organization Roles (Within Company):
- **ORG_ADMIN** → Organization owner/administrator
- **ORG_MANAGER** → Manager with limited admin rights
- **ORG_USER** → Regular employee/member

**UI Tip:** Show/hide features based on user role!

---

## 🌐 API Endpoints (For Frontend Developers)

### Base URL:
```
http://localhost:5000
```

### Public Endpoints (No Login Required):
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/register` | POST | Sign up |
| `/api/auth/login` | POST | Login |

### Protected Endpoints (Login Required):
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/profile` | GET | Get user info |
| `/api/:orgId/billing/invoices` | POST | Create invoice |
| `/api/:orgId/billing/invoices/:id` | GET | Get invoice |
| `/api/:orgId/billing/payments` | POST | Record payment |
| `/api/:orgId/billing/payments/:id/verify` | POST | Verify payment (admin) |

**Note:** Replace `:orgId` with actual organization ID from login response.

---

## 💡 Important Notes for UI/UX

### 1. Token Management
After login, you receive a **token**. This must be:
- Stored securely (localStorage/sessionStorage)
- Sent with every API request in the header:
  ```
  Authorization: Bearer YOUR_TOKEN_HERE
  ```

### 2. Organization Context
After login, you also get an **organization_id**. Use this in all billing URLs:
```
✅ Correct: /api/abc123/billing/invoices
❌ Wrong:   /api/billing/invoices
```

### 3. Error Handling
All API responses have this structure:
```json
{
  "success": true/false,
  "message": "What happened",
  "data": { ... }
}
```

Show `message` to users when `success: false`

### 4. Date Formatting
- Backend expects: `"2026-03-15"` (YYYY-MM-DD)
- Display to users: "March 15, 2026" (more readable)

### 5. Currency
- All amounts are in **Indian Rupees (₹)**
- Show amounts with proper formatting: `₹3,500.00`

---

## 🚀 Quick Start for Testing

### 1. Create an Account:
```bash
POST http://localhost:5000/api/auth/register
Body:
{
  "full_name": "Test User",
  "email": "test@example.com",
  "password": "password123",
  "organization_name": "Test Company",
  "industry_type": "APARTMENT"
}
```

### 2. Login:
```bash
POST http://localhost:5000/api/auth/login
Body:
{
  "email": "test@example.com",
  "password": "password123"
}
```

### 3. Save the token and organization_id from response!

---

## 📱 Recommended Screen Structure

### For Admin Dashboard:
```
├── Dashboard Home
│   ├── Statistics Overview
│   ├── Recent Invoices
│   └── Pending Payments
│
├── Invoices
│   ├── Create New Invoice
│   ├── View All Invoices
│   └── Filter/Search
│
├── Payments
│   ├── Verify Payments
│   ├── Payment History
│   └── Reports
│
└── Settings
    ├── Organization Details
    ├── UPI Configuration
    └── User Management
```

### For Resident/Customer Portal:
```
├── Dashboard
│   ├── Pending Invoices Count
│   ├── Total Due Amount
│   └── Recent Payments
│
├── My Invoices
│   ├── Pending
│   ├── Paid
│   └── Overdue
│
├── Payment History
│   └── Past Payments
│
└── Profile
    └── Personal Details
```

---

## 🎨 Design Tips

1. **Use Status Colors Consistently:** Same color for same status across all screens
2. **Show UPI Button Prominently:** Make it easy for residents to pay
3. **Real-time Updates:** Show loading states when creating invoices
4. **Confirmation Dialogs:** Before cancelling invoices or rejecting payments
5. **Empty States:** Design for when there are no invoices/payments yet
6. **Mobile Responsive:** Many residents will use mobile devices
7. **Accessibility:** Use proper contrast ratios and labels

---

## 🔄 Typical User Flows

### Admin Creating Monthly Maintenance:
```
1. Navigate to "Create Invoice"
2. Select "Bulk Create" option
3. Choose month/year
4. Set standard amount
5. Override for specific flats (if needed)
6. Review summary
7. Click "Generate Invoices"
8. Success message with count
```

### Resident Paying Invoice:
```
1. Login to portal
2. See pending invoices on dashboard
3. Click on invoice to view details
4. Click "Pay with UPI"
5. Choose UPI app (auto-opens)
6. Complete payment
7. Upload payment screenshot
8. Wait for admin verification
9. Receive confirmation
```

---

## ❓ Common Questions

**Q: Can one user belong to multiple organizations?**
A: Currently, no. Each user belongs to one organization only.

**Q: Can invoices be edited after creation?**
A: Only if they're in DRAFT status. Once sent, they should be cancelled and recreated.

**Q: What payment methods are supported?**
A: Currently, UPI payments (Indian market). Integration with gateways can be added.

**Q: How long do tokens last?**
A: 24 hours. After that, user must login again.

**Q: Can admins delete invoices?**
A: They should be cancelled (soft delete) rather than deleted to maintain audit trail.

---

**Happy Designing! 🎨**

For detailed technical information, see [PROJECT_DOCUMENTATION.md](PROJECT_DOCUMENTATION.md)
