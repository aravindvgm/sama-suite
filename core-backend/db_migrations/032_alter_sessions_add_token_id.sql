-- @no-transaction
/**
 * MIGRATION 032: Add token_id and device_label to sessions table.
 *
 * token_id  — opaque UUID prefix embedded in the refresh token string.
 *             Enables O(1) session lookup (SELECT ... WHERE token_id = $1 FOR UPDATE)
 *             without scanning all active sessions.
 *             Must be UNIQUE and NOT NULL.
 *
 * device_label — human-readable device hint derived from User-Agent
 *                (e.g. "Windows", "iOS", "Android"). Nullable.
 *
 * Phase 1: transactional — add columns, backfill, NOT NULL constraint.
 * Phase 2: CONCURRENTLY unique index (cannot run inside a transaction block).
 */

-- ── Phase 1 ──────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS token_id     UUID,
  ADD COLUMN IF NOT EXISTS device_label TEXT;

-- Backfill any existing rows (fresh installs will have none)
UPDATE sessions SET token_id = gen_random_uuid() WHERE token_id IS NULL;

-- Enforce NOT NULL now that every row has a value
ALTER TABLE sessions ALTER COLUMN token_id SET NOT NULL;

COMMIT;

-- ── Phase 2 — unique index (CONCURRENTLY, outside transaction) ────────────────

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_token_id
  ON sessions (token_id);
