/**
 * MIGRATION 036: Membership model prep (non-destructive)
 *
 * Goal:
 * - Ensure `organizations` table exists (id UUID, name TEXT, created_at TIMESTAMP)
 * - Ensure `memberships` table exists (id UUID, user_id, organization_id, role TEXT, created_at)
 * - Ensure unique (user_id, organization_id)
 *
 * Notes:
 * - This repo already has tenant/RBAC tables in some environments. This migration is
 *   written to be safe to run even when those tables/columns already exist.
 * - We do NOT drop or rename anything.
 */

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) organizations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) memberships
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- If memberships already exists (with a different shape), add role/created_at if missing.
ALTER TABLE memberships
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

ALTER TABLE memberships
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

-- Ensure unique (user_id, organization_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_memberships_user_org'
  ) THEN
    ALTER TABLE memberships
    ADD CONSTRAINT uq_memberships_user_org UNIQUE (user_id, organization_id);
  END IF;
END
$$;

COMMIT;

