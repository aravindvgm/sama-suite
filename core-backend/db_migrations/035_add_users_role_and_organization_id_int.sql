/**
 * MIGRATION 035: Basic RBAC + multi-tenant prep (non-destructive)
 *
 * - Adds users.role if missing (TEXT, default 'user')
 * - Adds users.organization_id (INTEGER) ONLY if the column does not already exist.
 *
 * Note:
 * - This codebase already uses `users.organization_id` as UUID in some environments.
 *   In that case, this migration will NOT overwrite or drop it.
 */

BEGIN;

-- 1) role (TEXT, default 'user')
ALTER TABLE users
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- 2) organization_id (INTEGER, nullable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE users ADD COLUMN organization_id INTEGER;
  END IF;
END
$$;

COMMIT;

