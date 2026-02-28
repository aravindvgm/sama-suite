# PostgreSQL Staging Database Setup - Complete

✅ **Status: SUCCESSFULLY CONFIGURED**

## Setup Summary

The PostgreSQL staging database has been successfully configured and verified with all required tables, indexes, and relationships.

### Connection Details

| Setting | Value |
|---------|-------|
| **Host** | localhost |
| **Port** | 5432 |
| **Database** | sama_staging |
| **User** | sama_user |
| **Password** | staging_password |
| **Connection URL** | postgresql://sama_user:staging_password@localhost:5432/sama_staging |
| **PostgreSQL Version** | 16.11 |

### Database Contents

#### Tables Created (8 total)

1. **organizations** - Multi-tenant organization records
   - 7 columns | 3 indexes | 32 KB

2. **users** - Application users with global roles
   - 7 columns | 3 indexes | 32 KB

3. **organization_users** - Junction table for user-organization relationships
   - 6 columns | 3 indexes | 24 KB

4. **invoices** - Invoice records with status tracking
   - 10 columns | 6 indexes | 56 KB

5. **invoice_items** - Line items within invoices
   - 9 columns | 3 indexes | 24 KB

6. **payments** - Payment transactions with financial integrity
   - 23 columns | 8 indexes | 72 KB

7. **adjustments** - Refunds, write-offs, and corrections
   - 27 columns | 6 indexes | 56 KB

8. **audit_logs** - Complete financial audit trail for compliance
   - 15 columns | 6 indexes | 64 KB

**Total Database Size: 360 KB**

### Foreign Key Relationships

All tables are properly linked with foreign key constraints:
- `organizations` ← has many → `users` (via organization_users junction table)
- `organizations` ← has many → `invoices`
- `invoices` ← has many → `invoice_items`
- `invoices` ← has many → `payments`
- `payments` ← referenced by → `adjustments`
- All entities audit-tracked via → `audit_logs`

### Indexes Created

- **organizations**: 3 indexes (code lookup optimization)
- **users**: 3 indexes (email-based authentication)
- **organization_users**: 3 indexes (org/user lookups)
- **invoices**: 6 indexes (org, status, date lookups)
- **invoice_items**: 3 indexes (org, invoice lookups)
- **payments**: 8 indexes (organization, status, external_id lookups)
- **adjustments**: 6 indexes (pending, approved status queries)
- **audit_logs**: 6 indexes (entity timeline, full-text search)

### Setup Scripts Created

Four utility scripts have been created for database management:

1. **test-db-connection.js** - Verify PostgreSQL connection
   ```bash
   node test-db-connection.js
   ```
   - Tests connection with staging credentials
   - Displays PostgreSQL version and database info
   - Lists existing tables

2. **setup-staging-db.js** - Initialize database and user (Node.js)
   ```bash
   node setup-staging-db.js
   ```

3. **setup-staging-db.bat** - Initialize database and user (Windows batch)
   ```bash
   .\setup-staging-db.bat
   ```

4. **run-migrations.js** - Apply database migrations
   ```bash
   node run-migrations.js
   ```
   - Applies 5 migrations in sequential order
   - Creates all tables and indexes
   - Handles dependencies between tables

5. **verify-db-setup.js** - Generate comprehensive verification report
   ```bash
   node verify-db-setup.js
   ```
   - Shows connection details
   - Lists all tables and indexes
   - Displays foreign key relationships
   - Confirms setup status

### Database Migration Files

Located in `db_migrations/` directory:

1. **000_create_base_tables.sql** (NEW)
   - organizations table
   - users table
   - organization_users junction table

2. **000_create_invoices_table.sql** (NEW)
   - invoices table
   - invoice_items table

3. **001_create_audit_logs.sql** (EXISTING)
   - audit_logs table with comprehensive audit trail
   - Full-text search indexes
   - Read-only enforcement

4. **002_create_payments_table.sql** (EXISTING)
   - payments table with idempotency via external_payment_id
   - Payment method enums
   - State machine constraints

5. **003_create_adjustments_table.sql** (EXISTING)
   - adjustments table for refunds, write-offs, credits
   - Approval workflow
   - Reversal tracking

### Key Features Configured

✓ **Multi-tenant Isolation** - organization_id on all tables
✓ **Idempotency** - UNIQUE constraint on (organization_id, external_payment_id)
✓ **State Machines** - Payment/adjustment/invoice status constraints
✓ **Immutable Records** - Soft deletes with is_reversed/is_refunded flags
✓ **Financial Integrity** - Amount validation and refund constraints
✓ **Audit Trail** - Complete change tracking with who/when/why
✓ **Performance** - 38 indexes optimized for query patterns
✓ **Security** - Read-only audit logs with role-based access

### Next Steps

#### Option 1: Quick Start (Development)
```bash
npm run dev
```
The server will connect to the staging database automatically via `.env.staging`

#### Option 2: Test the Connection via API
```bash
curl http://localhost:5001/db-test
```

#### Option 3: Seed Test Data (Optional)
```bash
node seed-test-data.js
```
Create sample organizations, users, and invoices for testing

#### Option 4: Manual Database Inspection
```bash
# Connect directly to PostgreSQL
psql -U sama_user -h localhost -d sama_staging

# List tables
\dt

# Describe a table
\d payments

# Exit
\q
```

### Environment Configuration

The `.env.staging` file is already configured with:
- Database credentials
- Node environment set to `staging`
- JWT secret (min 32 chars)
- Feature flags enabled
- Audit logging enabled
- API version v1
- Timezone: Asia/Kolkata

All environment variables are loaded automatically by the application using the `dotenv` package.

### Verification Checklist

- [x] PostgreSQL running and accessible
- [x] Database user `sama_user` created
- [x] Database `sama_staging` created
- [x] User has permissions on database
- [x] All 5 migrations applied successfully
- [x] All 8 tables created with correct structure
- [x] All 38 indexes created
- [x] All foreign key constraints established
- [x] Connection pool configured (max 20 connections)
- [x] Connection test passed
- [x] Verification report generated

### Troubleshooting

If you encounter any issues:

1. **Connection refused**
   - Verify PostgreSQL is running: `tasklist | grep postgres`
   - Check host/port in `.env.staging`

2. **Authentication failed**
   - Verify credentials in `.env.staging`
   - Reset password:
     ```sql
     ALTER USER sama_user WITH PASSWORD 'staging_password';
     ```

3. **Permission denied**
   - Grant privileges:
     ```sql
     GRANT ALL PRIVILEGES ON DATABASE sama_staging TO sama_user;
     ```

4. **Tables not found**
   - Re-run migrations:
     ```bash
     node run-migrations.js
     ```

### Support

For detailed documentation, see:
- `STAGING_SETUP_AND_TEST_GUIDE.md` - Full setup walkthrough
- `PROJECT_DOCUMENTATION.md` - Architecture and design
- `API_EXAMPLES.md` - API endpoint examples

---

**Setup Date:** February 15, 2026
**Status:** ✅ Complete and Verified
**Configuration:** Ready for Development/Testing
