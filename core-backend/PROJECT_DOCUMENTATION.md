# SAMA Technologies Core Backend - Documentation

## 📋 Project Overview

**SAMA Technologies Core Backend** is a multi-tenant backend system designed to serve multiple industries with a unified platform. The system currently supports various business types like Schools, Apartments, Gyms, POS systems, and Finance services.

**Tech Stack:**
- **Runtime:** Node.js
- **Framework:** Express.js (v5.2.1)
- **Database:** PostgreSQL
- **Authentication:** JWT (JSON Web Tokens)
- **Password Security:** Bcrypt

---

## 🏗️ System Architecture

### Multi-Tenant Design
The system is built as a **multi-tenant platform**, meaning:
- One codebase serves multiple organizations
- Each organization has isolated data
- Users belong to specific organizations
- All API routes are scoped by organization ID

### Role-Based Access Control (RBAC)
The system has **two levels of roles**:

1. **Platform Roles** (Global)
   - `SUPER_ADMIN` - Platform administrators who manage the entire system
   - `USER` - Regular users

2. **Organization Roles** (Within each organization)
   - `ORG_ADMIN` - Organization administrator (owner)
   - `ORG_MANAGER` - Organization manager
   - `ORG_USER` - Regular organization user

---

## 📦 Implemented Modules

### 1. **Authentication Module** (`/api/auth`)

This module handles user registration, login, and access control.

#### Features:
✅ **User Registration**
- Creates a new user account
- Automatically creates an organization
- Assigns the first user as `ORG_ADMIN` (owner)
- Generates unique organization code
- Returns JWT token for immediate login

✅ **User Login**
- Validates email and password
- Returns JWT token with user details
- Includes organization information

✅ **Profile Access**
- Get authenticated user profile
- Protected route (requires login)

✅ **Role-Based Access**
- Platform admin routes (for SUPER_ADMIN only)
- Organization admin routes (for ORG_ADMIN)

#### API Endpoints:

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/auth/register` | Public | Register new user & organization |
| POST | `/api/auth/login` | Public | Login with email & password |
| GET | `/api/auth/profile` | Authenticated | Get user profile |
| GET | `/api/auth/platform-admin` | Super Admin | Platform admin dashboard |
| GET | `/api/auth/org-admin` | Org Admin | Organization admin dashboard |

#### Registration Flow (For UI/UX):
```
User submits form with:
├─ Full Name
├─ Email
├─ Password
├─ Organization Name
└─ Industry Type (SCHOOL, APARTMENT, GYM, POS, FINANCE)

Backend processes:
1. Validates all fields
2. Checks if email already exists
3. Creates new organization with unique code
4. Creates user account with hashed password
5. Links user to organization as ORG_ADMIN
6. Returns JWT token + user details

User is automatically logged in!
```

#### Login Flow (For UI/UX):
```
User submits:
├─ Email
└─ Password

Backend processes:
1. Finds user by email
2. Verifies password
3. Gets organization membership
4. Generates JWT token
5. Returns token + user details

Token must be stored and sent with all protected requests!
```

---

### 2. **Billing Module** (`/api/:organizationId/billing`)

This module handles invoicing and payment management for organizations (primarily designed for apartment maintenance billing).

#### Features:
✅ **Invoice Management**
- Create individual invoices
- Create monthly maintenance for all flats
- View invoice details
- Get all invoices with filters
- Update invoice status
- Cancel invoices

✅ **Payment Processing**
- Create payment records
- Verify payments (admin approval)
- Reject payments
- Link payments to invoices

✅ **UPI Integration**
- Generate UPI payment links
- Automatic payment link creation for invoices
- Support for Indian payment systems

✅ **Resident Features**
- View pending invoices
- Get invoice details with UPI payment links
- Track payment history

✅ **Admin Features**
- Bulk invoice generation for monthly maintenance
- Payment verification and approval
- Payment summaries and reports
- Filter invoices by status, month, flat number

#### API Endpoints:

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/:orgId/billing/invoices` | Authenticated | Create new invoice |
| GET | `/api/:orgId/billing/invoices/:id` | Authenticated | Get invoice details |
| POST | `/api/:orgId/billing/invoices/:id/send` | Authenticated | Send invoice to resident |
| POST | `/api/:orgId/billing/payments` | Authenticated | Record a payment |
| POST | `/api/:orgId/billing/payments/:id/verify` | Admin | Approve payment |
| POST | `/api/:orgId/billing/payments/:id/reject` | Admin | Reject payment |

#### Invoice Creation Flow (For UI/UX):
```
Admin creates invoice:
├─ Select Person/Resident (person_id)
├─ Add Items (with quantity & price)
│  ├─ Item Name
│  ├─ Quantity
│  └─ Unit Price
├─ Set Due Date
└─ Optional Notes

Backend processes:
1. Validates all fields
2. Calculates line totals (quantity × price)
3. Calculates invoice total
4. Generates unique invoice number
5. Creates invoice in "DRAFT" status
6. Creates invoice items
7. Returns invoice details

Invoice Status: DRAFT → SENT → PENDING → PARTIAL → PAID
```

#### UPI Payment Flow (For UI/UX):
```
Resident views invoice:
1. System checks invoice status (pending/partial/overdue)
2. Generates UPI payment link with:
   ├─ Organization UPI ID
   ├─ Amount due
   ├─ Invoice number as reference
   └─ Description (e.g., "Maintenance Flat 101")

3. Resident clicks UPI link
4. Opens UPI app (Google Pay, PhonePe, Paytm)
5. Resident completes payment
6. Resident submits payment proof to system
7. Admin verifies payment
8. Invoice status updated
```

---

## 🔐 Security Middleware

### 1. **Authentication Middleware** (`auth.middleware.js`)
- Verifies JWT token in request headers
- Extracts user information from token
- Blocks unauthorized requests
- Required format: `Authorization: Bearer <token>`

### 2. **Role Middleware** (`role.middleware.js`)
- **Platform Role Authorization:** Controls access to platform-level features
- **Organization Role Authorization:** Controls access within organizations

### 3. **Organization Middleware** (`organization.middleware.js`)
- Validates organization access
- Ensures users can only access their organization's data

---

## 🗄️ Database Structure

### Core Tables (Inferred from Code):

1. **users**
   - `id` - User ID
   - `full_name` - User's full name
   - `email` - Email (unique)
   - `password` - Hashed password
   - `role` - Platform role (USER, SUPER_ADMIN)

2. **organizations**
   - `id` - Organization ID
   - `name` - Organization name
   - `code` - Unique organization code
   - `industry_type` - SCHOOL, APARTMENT, GYM, POS, FINANCE
   - `upi_id` - UPI ID for payments

3. **organization_users** (Junction Table)
   - `organization_id` - Links to organization
   - `user_id` - Links to user
   - `org_role` - Role within organization (ORG_ADMIN, ORG_MANAGER, ORG_USER)
   - `is_owner` - Boolean flag for organization owner

4. **invoices**
   - `id` - Invoice ID
   - `organization_id` - Links to organization
   - `person_id` - Who the invoice is for
   - `invoice_number` - Unique invoice number (e.g., INV-ABC12345)
   - `total_amount` - Total invoice amount
   - `due_date` - Payment due date
   - `status` - DRAFT, SENT, PENDING, PARTIAL, PAID, OVERDUE, CANCELLED
   - `notes` - Additional notes
   - `created_at` - Creation timestamp
   - `updated_at` - Last update timestamp

5. **invoice_items**
   - `id` - Item ID
   - `organization_id` - Links to organization
   - `invoice_id` - Links to invoice
   - `item_name` - Description of item/service
   - `quantity` - Quantity
   - `unit_price` - Price per unit
   - `total_amount` - Line total (quantity × unit_price)

---

## 🛠️ Utilities

### 1. **Async Handler** (`asyncHandler.js`)
- Wraps async route handlers
- Automatically catches errors
- Sends errors to global error handler

### 2. **UPI Service** (`upi.service.js`)
- Generates UPI payment links
- Formats payment URLs for Indian UPI apps
- Includes organization details and invoice reference

---

## 🚀 API Usage Examples

### Example 1: Register a New Organization

**Request:**
```http
POST /api/auth/register
Content-Type: application/json

{
  "full_name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword123",
  "organization_name": "Green Valley Apartments",
  "industry_type": "APARTMENT"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "full_name": "John Doe",
    "email": "john@example.com",
    "organization_id": "987fcdeb-51a2-43b8-9012-345678901234",
    "orgRole": "ORG_ADMIN"
  }
}
```

### Example 2: Login

**Request:**
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "full_name": "John Doe",
    "email": "john@example.com",
    "organization_id": "987fcdeb-51a2-43b8-9012-345678901234",
    "orgRole": "ORG_ADMIN"
  }
}
```

### Example 3: Create Invoice

**Request:**
```http
POST /api/987fcdeb-51a2-43b8-9012-345678901234/billing/invoices
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "person_id": "person-uuid-here",
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
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "invoice": {
    "id": "invoice-uuid-here",
    "invoice_number": "INV-ABC12345",
    "total_amount": 4000,
    "status": "DRAFT"
  }
}
```

---

## 🔄 Application Flow

### User Journey (From UI/UX Perspective)

```
1. REGISTRATION
   User fills form → Backend creates org & user → Returns token → User logged in

2. LOGIN
   User enters credentials → Backend validates → Returns token → Dashboard access

3. CREATE INVOICE (Admin)
   Admin selects resident → Adds items → Sets due date → Invoice created → Status: DRAFT

4. SEND INVOICE
   Admin sends invoice → Status changes to SENT → Resident can now view it

5. RESIDENT VIEWS INVOICE
   Resident logs in → Views pending invoices → Sees UPI payment link

6. PAYMENT
   Resident clicks UPI link → Pays via UPI app → Submits payment proof → Admin verifies

7. ADMIN VERIFIES
   Admin reviews payment → Verifies → Invoice status updates to PAID/PARTIAL
```

---

## ⚙️ Environment Configuration

The system requires these environment variables (`.env` file):

```env
NODE_ENV=development
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sama_technologies
DB_USER=postgres
DB_PASSWORD=your_password_here
JWT_SECRET=sama_technologies_jwt_secret_key_2026
```

---

## 🚦 Running the Project

### Development Mode:
```bash
npm run dev
```
This starts the server with auto-reload on file changes (using nodemon).

### Production Mode:
```bash
npm start
```
This starts the server without auto-reload.

**Server runs on:** `http://localhost:5000`

### Test Database Connection:
```
GET http://localhost:5000/db-test
```

---

## 📊 Invoice Status Flow

```
DRAFT
  ↓ (Admin sends invoice)
SENT
  ↓ (Due date arrives)
PENDING
  ↓ (Partial payment received)
PARTIAL
  ↓ (Full payment received)
PAID

Special statuses:
- OVERDUE: Invoice past due date with pending payment
- CANCELLED: Invoice cancelled by admin
```

---

## 🎨 UI/UX Considerations

### For Authentication Screens:
1. **Registration Form:**
   - Fields: Full Name, Email, Password, Organization Name, Industry Type
   - Industry Type: Dropdown (School, Apartment, Gym, POS, Finance)
   - Show loading state during registration
   - Auto-login after successful registration

2. **Login Form:**
   - Fields: Email, Password
   - Remember token securely
   - Redirect to dashboard after login

### For Invoice Management:
1. **Admin Invoice Creation:**
   - Resident selector
   - Dynamic item list (add/remove items)
   - Auto-calculate totals
   - Date picker for due date
   - Save as draft / Send immediately options

2. **Resident Invoice View:**
   - List of pending invoices
   - Filter by status (Pending, Partial, Overdue, Paid)
   - Each invoice shows:
     - Invoice number
     - Total amount
     - Due date
     - Payment status
     - UPI payment button (if unpaid)

3. **Payment Verification (Admin):**
   - List of unverified payments
   - View payment proof/screenshot
   - Approve/Reject buttons
   - Add notes on rejection

---

## 🔒 Security Features

1. **Password Security:**
   - Passwords hashed using bcrypt (10 salt rounds)
   - Never stored in plain text

2. **JWT Authentication:**
   - Token expires in 24 hours
   - Token includes user ID, organization ID, and roles
   - All protected routes verify token

3. **Multi-Tenant Data Isolation:**
   - All queries scoped by organization_id
   - Users can only access their organization's data

4. **Transaction Safety:**
   - Database transactions ensure data consistency
   - Automatic rollback on errors

---

## 📈 What's Next? (Future Modules)

Based on the current architecture, the system is ready for:
- Payment gateway integration (Razorpay, Stripe)
- Email/SMS notifications
- Dashboard analytics
- Reports generation
- Resident management
- Maintenance requests
- Document management
- Expense tracking

---

## 🤝 For Frontend Developers

### Headers Required for API Calls:

**Unauthenticated Routes:**
```javascript
{
  "Content-Type": "application/json"
}
```

**Authenticated Routes:**
```javascript
{
  "Content-Type": "application/json",
  "Authorization": "Bearer YOUR_JWT_TOKEN_HERE"
}
```

### Token Storage:
Store the JWT token securely (e.g., localStorage, sessionStorage, or cookies) and include it in all protected API requests.

### Error Handling:
All API responses follow this format:
```json
{
  "success": true/false,
  "message": "Description of what happened",
  "data": { ... }  // Only if success: true
}
```

---

## 📞 Support & Questions

For technical questions about this backend, refer to:
- Authentication flow → [auth.service.js](src/modules/auth/auth.service.js)
- Billing/Invoice logic → [invoice.service.js](src/modules/billing/invoice.service.js)
- API routes → [auth.routes.js](src/modules/auth/auth.routes.js) & [billing.routes.js](src/modules/billing/billing.routes.js)

---

**Last Updated:** February 2026
**Version:** 1.0.0
**Status:** ✅ Active Development
