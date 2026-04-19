-- @no-transaction
/*
 MIGRATION 020 (rev 2): Audit Log Governance - Multi-actor model + safe ENUM removal

 Replaces rev 1 of this migration with:
   - Conditional ENUM type drops (pg_attribute dependency check)
   - CHECK constraint: actor_user_id IS NOT NULL when actor_type = 'USER'
   - Safety reclassification before constraint addition
   - Idempotent constraint guards (DO blocks + pg_constraint checks)
   - CONCURRENTLY indexes in Phase 2 (large-table safe, no lock)

 Phase 1: BEGIN...COMMIT
 Phase 2: CREATE INDEX CONCURRENTLY (outside transaction)

 Backward compatible: no audit data removed.
*/

BEGIN;

-- Step 1: Widen entity_type ENUM -> VARCHAR
ALTER TABLE audit_logs
  ALTER COLUMN entity_type TYPE VARCHAR(50)
  USING entity_type::TEXT;

-- Step 2: Widen action ENUM -> VARCHAR
ALTER TABLE audit_logs
  ALTER COLUMN action TYPE VARCHAR(50)
  USING action::TEXT;

-- Step 3: Drop NOT NULL on changed_by
ALTER TABLE audit_logs
  ALTER COLUMN changed_by DROP NOT NULL;

-- Step 4: Drop NOT NULL on organization_id (safe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE audit_logs ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;

-- Step 5: actor_type
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'USER';

-- Step 6: constraint actor_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_actor_type'
      AND conrelid = 'audit_logs'::regclass
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_actor_type
      CHECK (actor_type IN ('USER','SYSTEM','AI'));
  END IF;
END $$;

-- Step 7: actor_user_id
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_user_id UUID;

-- Step 8: meta JSONB
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS meta JSONB;

-- Step 9: backfill
UPDATE audit_logs
SET actor_user_id = changed_by
WHERE actor_user_id IS NULL
  AND changed_by IS NOT NULL;

-- Step 10: reclassification
UPDATE audit_logs
SET actor_type = 'SYSTEM'
WHERE actor_type = 'USER'
  AND actor_user_id IS NULL
  AND changed_by IS NULL;

-- Step 11: constraint actor_user_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_actor_user_required'
      AND conrelid = 'audit_logs'::regclass
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_actor_user_required
      CHECK (actor_type != 'USER' OR actor_user_id IS NOT NULL);
  END IF;
END $$;

-- Step 12a: drop enum safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE t.typname = 'audit_entity_type'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    DROP TYPE IF EXISTS audit_entity_type;
  END IF;
END $$;

-- Step 12b: drop enum safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE t.typname = 'audit_action_type'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    DROP TYPE IF EXISTS audit_action_type;
  END IF;
END $$;

-- comments
COMMENT ON COLUMN audit_logs.actor_type
IS 'Actor category: USER | SYSTEM | AI';

COMMENT ON COLUMN audit_logs.actor_user_id
IS 'User UUID required when actor_type = USER';

COMMENT ON COLUMN audit_logs.meta
IS 'Lightweight JSONB change summary';

COMMIT;

-- PHASE 2 (no transaction)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_org_created
  ON audit_logs (organization_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_entity_lookup
  ON audit_logs (entity_type, entity_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_system_actors
  ON audit_logs (actor_type, created_at DESC)
  WHERE actor_type IN ('SYSTEM','AI');