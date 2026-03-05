/**
 * MIGRATION 033: Schema alignment — bridge gap between early migrations and application code.
 *
 * auth.service.js was written for a schema that the early migrations (000, 004, 007)
 * do not fully implement. This migration is the authoritative fix for all mismatches.
 *
 * Changes:
 *  1. users.password  → users.password_hash  (code uses password_hash)
 *  2. users.is_active BOOLEAN               (code checks is_active; migration 004 added status TEXT)
 *  3. users.organization_id UUID            (register() inserts organization_id)
 *  4. roles.key VARCHAR(50)                 (code queries WHERE key = 'org_admin')
 *  5. memberships table                     (code uses memberships, not user_memberships)
 *
 * All steps are idempotent — safe to re-run on any DB state.
 */

BEGIN;

-- ── 1. Rename users.password → users.password_hash ───────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'users' AND column_name = 'password'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name = 'users' AND column_name = 'password_hash'
  ) THEN
    ALTER TABLE users RENAME COLUMN password TO password_hash;
  END IF;
END $$;

-- ── 2. Add is_active BOOLEAN to users ────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Sync is_active from existing status column (migration 004 added status TEXT)
UPDATE users
  SET is_active = (status != 'inactive')
  WHERE status IS NOT NULL;

-- ── 3. Add organization_id to users (nullable — global identity, set at registration) ──
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS organization_id UUID
    REFERENCES organizations(id) ON DELETE SET NULL;

-- ── 4. Add key column to roles ───────────────────────────────────────────────
-- key is a stable machine-readable identifier (e.g. 'org_admin', 'teacher')
-- alongside the human-readable name field.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS key VARCHAR(50);

-- Backfill: derive key from name (lowercase, spaces → underscores)
UPDATE roles
  SET key = LOWER(REPLACE(name, ' ', '_'))
  WHERE key IS NULL;

-- Unique index on (organization_id, key) for fast role lookups
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE  tablename = 'roles' AND indexname = 'idx_roles_org_key'
  ) THEN
    CREATE UNIQUE INDEX idx_roles_org_key ON roles (organization_id, key)
      WHERE key IS NOT NULL;
  END IF;
END $$;

-- ── 5. Create memberships table ───────────────────────────────────────────────
-- auth.service.js queries: SELECT FROM memberships WHERE status = 'active'
-- Migration 007 created user_memberships (different name, no status column).
CREATE TABLE IF NOT EXISTS memberships (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id)          ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES organizations(id)  ON DELETE CASCADE,
  role_id         UUID        NOT NULL REFERENCES roles(id)          ON DELETE RESTRICT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_membership_user_org UNIQUE (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org  ON memberships (organization_id);

-- Migrate any rows from user_memberships into memberships (idempotent)
INSERT INTO memberships (user_id, organization_id, role_id)
SELECT um.user_id, um.organization_id, um.role_id
FROM   user_memberships um
WHERE  NOT EXISTS (
  SELECT 1 FROM memberships m
  WHERE  m.user_id         = um.user_id
    AND  m.organization_id = um.organization_id
)
ON CONFLICT (user_id, organization_id) DO NOTHING;

COMMIT;
