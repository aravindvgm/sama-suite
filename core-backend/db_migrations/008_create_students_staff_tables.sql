/**
 * MIGRATION: Create students and staff tables
 *
 * Both tables are:
 * - Multi-tenant isolated via organization_id
 * - Soft-delete capable via deleted_at / deleted_by
 * - Audit-tracked via created_by / created_at / updated_at
 */

-- ============================================================
-- TABLE: students
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,

  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,

  -- Audit
  created_by       UUID,
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Soft delete
  deleted_at       TIMESTAMP,
  deleted_by       UUID,

  -- Foreign keys
  CONSTRAINT fk_student_org
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_student_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_student_deleted_by
    FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_student_org
  ON students(organization_id);

CREATE INDEX idx_student_org_created_at
  ON students(organization_id, created_at);

CREATE INDEX idx_student_org_active
  ON students(organization_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE students IS 'Student records. Multi-tenant isolated by organization_id. Supports soft delete and full audit trail.';
COMMENT ON COLUMN students.deleted_at IS 'NULL means active. Non-NULL means soft-deleted. Always filter WHERE deleted_at IS NULL in application queries.';
COMMENT ON COLUMN students.deleted_by IS 'User who performed the soft delete.';


-- ============================================================
-- TABLE: staff
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,

  first_name       VARCHAR(100) NOT NULL,
  last_name        VARCHAR(100) NOT NULL,

  -- Audit
  created_by       UUID,
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Soft delete
  deleted_at       TIMESTAMP,
  deleted_by       UUID,

  -- Foreign keys
  CONSTRAINT fk_staff_org
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT fk_staff_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_staff_deleted_by
    FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_staff_org
  ON staff(organization_id);

CREATE INDEX idx_staff_org_created_at
  ON staff(organization_id, created_at);

CREATE INDEX idx_staff_org_active
  ON staff(organization_id)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE staff IS 'Staff records. Multi-tenant isolated by organization_id. Supports soft delete and full audit trail.';
COMMENT ON COLUMN staff.deleted_at IS 'NULL means active. Non-NULL means soft-deleted. Always filter WHERE deleted_at IS NULL in application queries.';
COMMENT ON COLUMN staff.deleted_by IS 'User who performed the soft delete.';
