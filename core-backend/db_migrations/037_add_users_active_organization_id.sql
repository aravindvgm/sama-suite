/**
 * MIGRATION 037: Active organization context (non-destructive)
 */

BEGIN;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS active_organization_id UUID;

COMMIT;

