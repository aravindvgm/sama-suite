/**
 * MIGRATION: Create base tables for organizations and users
 *
 * This migration creates the foundation tables for the SAMA-SUITE application:
 * - organizations: Multi-tenant organization records
 * - users: Application users
 * - organization_users: Junction table for user-organization relationships
 */

-- Create organizations table
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  code VARCHAR(50) UNIQUE NOT NULL,
  industry_type VARCHAR(50) NOT NULL,
  upi_id VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index on organization code for quick lookups
CREATE INDEX idx_org_code ON organizations(code);

-- Create users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'USER',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create index on user email for authentication
CREATE INDEX idx_user_email ON users(email);

-- Create organization_users junction table
CREATE TABLE organization_users (
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  org_role VARCHAR(50) NOT NULL DEFAULT 'ORG_USER',
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT fk_org_user_org FOREIGN KEY (organization_id) REFERENCES organizations(id),
  CONSTRAINT fk_org_user_user FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create indexes for organization_users lookup
CREATE INDEX idx_org_users_org ON organization_users(organization_id);
CREATE INDEX idx_org_users_user ON organization_users(user_id);

-- Add comments for documentation
COMMENT ON TABLE organizations IS 'Multi-tenant organizations. Each organization is independent with separate billing/payment tracking.';
COMMENT ON TABLE users IS 'Application users with global roles. User-organization relationship managed via organization_users junction table.';
COMMENT ON TABLE organization_users IS 'Junction table linking users to organizations with organization-specific roles (ORG_ADMIN, ORG_MANAGER, ORG_USER).';
