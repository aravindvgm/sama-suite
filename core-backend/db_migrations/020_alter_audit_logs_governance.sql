/**
 * MIGRATION 020 (rev 2): Audit Log Governance — Multi-actor model + safe ENUM removal
 *
 * Replaces rev 1 of this migration with:
 *   - Conditional ENUM type drops (pg_attribute dependency check)
 *   - CHECK constraint: actor_user_id IS NOT NULL when actor_type = 'USER'
 *   - Safety reclassification before constraint addition
 *   - Idempotent constraint guards (DO blocks + pg_constraint checks)
 *   - CONCURRENTLY indexes in Phase 2 (large-table safe, no lock)
 *
 * Phase 1: BEGIN...COMMIT  (schema changes, backfill, constraints, ENUM drops)
 * Phase 2: bare statements (CREATE INDEX CONCURRENTLY — cannot run in transaction)
 *
 * Backward compatible: no audit data removed, no existing indexes dropped.
 *
 * Existing 001 indexes preserved:
 *   idx_audit_org_entity, idx_audit_org_timestamp, idx_audit_user,
 *   idx_audit_entity_timeline, idx_audit_reason
 */

-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Schema changes (transactional)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 1: Widen entity_type: ENUM → VARCHAR(50) ─────────────────────────────
-- USING cast converts each stored ENUM label to its TEXT value — zero data loss.
-- After this the column no longer references audit_entity_type, but other tables
-- may still hold a dependency (checked in Step 12a before any DROP).
ALTER TABLE audit_logs
  ALTER COLUMN entity_type TYPE VARCHAR(50)
    USING entity_type::TEXT;

-- ── Step 2: Widen action: ENUM → VARCHAR(50) ──────────────────────────────────
ALTER TABLE audit_logs
  ALTER COLUMN action TYPE VARCHAR(50)
    USING action::TEXT;

-- ── Step 3: Drop NOT NULL on changed_by (FK fk_user kept intact) ──────────────
-- Allows SYSTEM and AI actor rows to omit a user UUID.
-- Referential integrity for non-null values is preserved by the existing FK.
ALTER TABLE audit_logs
  ALTER COLUMN changed_by DROP NOT NULL;

-- ── Step 4: Drop NOT NULL on organization_id (idempotent) ─────────────────────
-- Cross-org SYSTEM workers (job scheduler, birthday reminders, fee dispatcher)
-- operate across all tenants with no single organization_id to attach.
-- Tenant scoping for USER/API entries is enforced at the application layer.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_name  = 'audit_logs'
      AND  column_name = 'organization_id'
      AND  is_nullable = 'NO'
  ) THEN
    ALTER TABLE audit_logs ALTER COLUMN organization_id DROP NOT NULL;
  END IF;
END $$;

-- ── Step 5: Add actor_type column (idempotent) ────────────────────────────────
-- DEFAULT 'USER' ensures zero impact on existing rows — they are all treated
-- as human-initiated events until Step 10 reclassifies any anomalies.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20) NOT NULL DEFAULT 'USER';

-- ── Step 6: Add chk_actor_type CHECK (idempotent) ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname    = 'chk_actor_type'
      AND  conrelid   = 'audit_logs'::regclass
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_actor_type
        CHECK (actor_type IN ('USER', 'SYSTEM', 'AI'));
  END IF;
END $$;

-- ── Step 7: Add actor_user_id column (idempotent) ────────────────────────────
-- USER actors: mirrors changed_by for query ergonomics (denormalized).
-- SYSTEM/AI actors: NULL unless a service-account UUID is applicable.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS actor_user_id UUID;

-- ── Step 8: Add meta JSONB column (idempotent) ────────────────────────────────
-- Lightweight change summary only (field-level old/new values).
-- Must NOT store full record snapshots — new_state column handles that.
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS meta JSONB;

-- ── Step 9: Backfill actor_user_id from changed_by ───────────────────────────
-- Applies to all pre-existing rows and any rows written between migrations
-- (e.g. if rev 1 of this migration was partially applied on this database).
UPDATE audit_logs
  SET   actor_user_id = changed_by
  WHERE actor_user_id IS NULL
    AND changed_by    IS NOT NULL;

-- ── Step 10: Safety reclassification before constraint ───────────────────────
-- Any USER row with null actor_user_id AND null changed_by has no traceable
-- human identity. These rows predate the actor model and represent automated
-- or system-initiated events that were not properly categorised at write time.
-- Reclassifying them to SYSTEM ensures Step 11's constraint validates cleanly
-- without failing on legacy data.
UPDATE audit_logs
  SET   actor_type = 'SYSTEM'
  WHERE actor_type     =  'USER'
    AND actor_user_id IS NULL
    AND changed_by    IS NULL;

-- ── Step 11: Add chk_actor_user_required CHECK (idempotent) ──────────────────
-- Governance rule: human-initiated (USER) audit entries must always carry a
-- traceable user identity. SYSTEM and AI actors may have null actor_user_id
-- when no service-account UUID is applicable.
--
-- Steps 9 + 10 above guarantee no existing row violates this constraint before
-- it is added.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname  = 'chk_actor_user_required'
      AND  conrelid = 'audit_logs'::regclass
  ) THEN
    ALTER TABLE audit_logs
      ADD CONSTRAINT chk_actor_user_required
        CHECK (actor_type != 'USER' OR actor_user_id IS NOT NULL);
  END IF;
END $$;

-- ── Step 12a: Conditionally drop audit_entity_type ENUM ──────────────────────
-- Queries pg_attribute to determine whether any column in any table still
-- uses this type. Silently skips the drop if a dependency exists — safe to
-- run regardless of other schema state.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_attribute a
    JOIN   pg_type      t ON t.oid = a.atttypid
    WHERE  t.typname      = 'audit_entity_type'
      AND  a.attnum       > 0
      AND  NOT a.attisdropped
  ) THEN
    DROP TYPE IF EXISTS audit_entity_type;
  END IF;
END $$;

-- ── Step 12b: Conditionally drop audit_action_type ENUM ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_attribute a
    JOIN   pg_type      t ON t.oid = a.atttypid
    WHERE  t.typname      = 'audit_action_type'
      AND  a.attnum       > 0
      AND  NOT a.attisdropped
  ) THEN
    DROP TYPE IF EXISTS audit_action_type;
  END IF;
END $$;

-- ── Column comments ───────────────────────────────────────────────────────────
COMMENT ON COLUMN audit_logs.actor_type
  IS 'Actor category: USER | SYSTEM | AI. USER is the backward-compatible default.';
COMMENT ON COLUMN audit_logs.actor_user_id
  IS 'Denormalized user UUID. Required (NOT NULL) when actor_type = USER per chk_actor_user_required. NULL for SYSTEM/AI actors without a user context.';
COMMENT ON COLUMN audit_logs.meta
  IS 'Lightweight JSONB change summary (field-level old/new values only). NOT full record snapshots — new_state column handles that.';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — Index creation (CONCURRENTLY)
--
-- CONCURRENTLY never takes a full table lock — safe on tables of any size.
-- Must run outside a transaction block (PostgreSQL restriction).
-- IF NOT EXISTS prevents errors on re-runs or partial previous application.
--
-- Existing indexes from migration 001 are preserved and not duplicated:
--   idx_audit_org_entity      (organization_id, entity_id, action)
--   idx_audit_org_timestamp   (organization_id, changed_at DESC)
--   idx_audit_user            (changed_by, changed_at DESC)
--   idx_audit_entity_timeline (entity_type, entity_id, changed_at ASC)
--   idx_audit_reason          GIN on reason
-- ═══════════════════════════════════════════════════════════════════════════════

-- Tenant-scoped time-ordered queries (dashboard, compliance reports, API pagination)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_org_created
  ON audit_logs (organization_id, created_at DESC);

-- Entity history: all state changes for a specific invoice, payment, student, etc.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_entity_lookup
  ON audit_logs (entity_type, entity_id);

-- Partial index: efficient monitoring and alerting on non-human actor events
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_system_actors
  ON audit_logs (actor_type, created_at DESC)
  WHERE actor_type IN ('SYSTEM', 'AI');
