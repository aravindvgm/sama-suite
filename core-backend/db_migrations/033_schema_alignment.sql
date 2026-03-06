/**
 * MIGRATION 033: Schema alignment — bridge gap between early migrations and application code.
 *
 * Fixes schema mismatches between early migrations and application code.
 * Safe to run multiple times (idempotent).
 */

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ensure password_hash column exists
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Rename password → password_hash if older schema exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='password'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='users' AND column_name='password_hash'
  ) THEN
    ALTER TABLE users RENAME COLUMN password TO password_hash;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add is_active column
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE users
SET is_active = (status != 'inactive')
WHERE status IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add organization_id to users
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
ADD COLUMN IF NOT EXISTS organization_id UUID
REFERENCES organizations(id)
ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Add roles.key column
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE roles
ADD COLUMN IF NOT EXISTS key VARCHAR(50);

UPDATE roles
SET key = LOWER(REPLACE(name,' ','_'))
WHERE key IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename='roles'
    AND indexname='idx_roles_org_key'
  ) THEN
    CREATE UNIQUE INDEX idx_roles_org_key
    ON roles (organization_id, key)
    WHERE key IS NOT NULL;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Create memberships table
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add unique constraint safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='uq_membership_user_org'
  ) THEN
    ALTER TABLE memberships
    ADD CONSTRAINT uq_membership_user_org
    UNIQUE (user_id, organization_id);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_memberships_user
ON memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_memberships_org
ON memberships(organization_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Migrate data from user_memberships
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO memberships (user_id, organization_id, role_id)
SELECT um.user_id, um.organization_id, um.role_id
FROM user_memberships um
WHERE NOT EXISTS (
  SELECT 1
  FROM memberships m
  WHERE m.user_id = um.user_id
  AND m.organization_id = um.organization_id
);
ON CONFLICT (user_id, organization_id) DO NOTHING;

COMMIT;