/**
 * MIGRATION: Create persons table for billing contacts/customers
 *
 * This table stores persons (customers, clients, residents, students)
 * who receive invoices. Multi-tenant isolated by organization_id.
 *
 * Used by: invoices.person_id → persons.id
 */

-- Create persons table
CREATE TABLE IF NOT EXISTS persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,

  -- Person details
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,

  -- Business details (for CA billing)
  person_type VARCHAR(50) NOT NULL DEFAULT 'INDIVIDUAL',
  pan VARCHAR(10),
  gstin VARCHAR(15),

  -- Audit trail
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT fk_person_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Performance indexes
CREATE INDEX idx_person_org ON persons(organization_id);
CREATE INDEX idx_person_org_name ON persons(organization_id, name);
CREATE INDEX idx_person_org_email ON persons(organization_id, email);

-- Add FK from invoices to persons (if not already exists)
-- ALTER TABLE invoices ADD CONSTRAINT fk_invoice_person FOREIGN KEY (person_id) REFERENCES persons(id);

-- Documentation
COMMENT ON TABLE persons IS 'Billing contacts/customers. Multi-tenant isolated. Referenced by invoices.person_id.';
COMMENT ON COLUMN persons.person_type IS 'INDIVIDUAL or BUSINESS. Determines required fields (PAN vs GSTIN).';
