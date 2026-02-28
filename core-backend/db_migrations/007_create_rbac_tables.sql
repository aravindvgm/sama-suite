/**
 * MIGRATION: Create RBAC tables for roles, permissions, and user memberships
 *
 * Tables:
 * - roles: Tenant-scoped roles. Each organization defines its own roles.
 * - permissions: Global permission definitions (module + action pairs).
 * - role_permissions: Many-to-many mapping of roles to permissions, tenant-scoped.
 * - user_memberships: A user's active role within an organization.
 *
 * Architecture:
 * - Roles are tenant-scoped (organization_id required).
 * - Permissions are global (no organization_id).
 * - role_permissions carries organization_id for tenant isolation on joins.
 * - user_memberships is the source of truth for "who can do what in org X".
 */

-- ============================================================
-- TABLE: permissions (global, not tenant-scoped)
-- ============================================================
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,

  CONSTRAINT uq_permission_module_action UNIQUE (module, action)
);

CREATE INDEX idx_permission_module ON permissions(module);

COMMENT ON TABLE permissions IS 'Global permission definitions. Not tenant-scoped. Permissions are defined at the platform level and assigned to roles per tenant.';
COMMENT ON COLUMN permissions.module IS 'Feature module the permission belongs to (e.g. invoices, payments, users).';
COMMENT ON COLUMN permissions.action IS 'Action allowed within the module (e.g. read, create, update, delete).';


-- ============================================================
-- TABLE: roles (tenant-scoped)
-- ============================================================
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name VARCHAR(50) NOT NULL,
  is_system_role BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_role_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT uq_role_org_name UNIQUE (organization_id, name)
);

CREATE INDEX idx_role_org ON roles(organization_id);
CREATE INDEX idx_role_org_name ON roles(organization_id, name);

COMMENT ON TABLE roles IS 'Tenant-scoped roles. Each organization manages its own roles independently.';
COMMENT ON COLUMN roles.is_system_role IS 'System roles (e.g. OWNER, ADMIN) are seeded and cannot be deleted by the tenant.';


-- ============================================================
-- TABLE: role_permissions (tenant-scoped junction)
-- ============================================================
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL,
  permission_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (role_id, permission_id),

  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX idx_rp_role ON role_permissions(role_id);
CREATE INDEX idx_rp_org ON role_permissions(organization_id);
CREATE INDEX idx_rp_org_role ON role_permissions(organization_id, role_id);

COMMENT ON TABLE role_permissions IS 'Maps permissions to roles within a tenant. organization_id is denormalized here to allow efficient tenant-scoped permission lookups without joining roles.';


-- ============================================================
-- TABLE: user_memberships
-- ============================================================
CREATE TABLE IF NOT EXISTS user_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  role_id UUID NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
  CONSTRAINT uq_membership_user_org UNIQUE (user_id, organization_id)
);

CREATE INDEX idx_membership_user ON user_memberships(user_id);
CREATE INDEX idx_membership_org ON user_memberships(organization_id);
CREATE INDEX idx_membership_user_org ON user_memberships(user_id, organization_id);
CREATE INDEX idx_membership_role ON user_memberships(role_id);

COMMENT ON TABLE user_memberships IS 'Assigns a user a role within an organization. One active membership per user per org enforced by unique constraint.';
