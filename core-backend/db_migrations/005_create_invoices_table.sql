/**
 * MIGRATION: Create invoices and invoice_items tables
 *
 * This migration creates tables for managing invoices and their line items
 * - invoices: Main invoice records with status tracking
 * - invoice_items: Line items within each invoice
 */

-- Create invoices table
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  person_id UUID NOT NULL,
  invoice_number VARCHAR(100) UNIQUE NOT NULL,
  total_amount NUMERIC(12, 2) NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_invoice_org FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Create indexes for invoice queries
CREATE INDEX idx_invoice_org ON invoices(organization_id);
CREATE INDEX idx_invoice_org_number ON invoices(organization_id, invoice_number);
CREATE INDEX idx_invoice_status ON invoices(organization_id, status);
CREATE INDEX idx_invoice_due_date ON invoices(due_date);

-- Create invoice_items table
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  total_amount NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_item_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_item_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT quantity_positive CHECK (quantity > 0),
  CONSTRAINT unit_price_nonnegative CHECK (unit_price >= 0)
);

-- Create indexes for invoice_items queries
CREATE INDEX idx_item_org ON invoice_items(organization_id);
CREATE INDEX idx_item_invoice ON invoice_items(invoice_id);

-- Add comments for documentation
COMMENT ON TABLE invoices IS 'Invoice records with multi-tenant isolation. Status progression: DRAFT → SENT → PENDING → PARTIAL/PAID/OVERDUE.';
COMMENT ON TABLE invoice_items IS 'Line items within invoices. quantity and unit_price determine total_amount. Supports partial payments.';
