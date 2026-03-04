-- ============================================================
-- MIGRATION 027: API Access Logs + school_risk_config extension
-- ============================================================
--
-- Phase-8.6 primary telemetry table.
--
-- api_access_logs
--   Written by API logging middleware for every HTTP request.
--   Provides path-based endpoint family classification, bytes_sent
--   for large-transfer detection, and full HTTP context that
--   audit_logs does not carry.
--
--   Behavioral risk signals use this table as PRIMARY source:
--     ENUMERATION             — path matches /students pattern
--     EXPORT_SPIKE            — path matches /export|download, or bytes_sent > threshold
--     SENSITIVE_CONCENTRATION — path classified into sensitive families
--     OFF_HOURS               — created_at during configured off-hours
--     ROLE_DEVIATION          — accessed families vs role profile
--
--   audit_logs remains the fallback — revert to Phase-8.5 detector
--   implementations if this table is unavailable.
--
-- school_risk_config extension
--   Adds large_bytes_threshold (bytes) for configurable export spike
--   detection based on response size. Default: 1 MiB (1,048,576 bytes).
--
-- Indexing strategy
--   Phase 1: no indexes on new table (table is empty; indexes add cost
--   without benefit until populated).
--   Phase 2: three CONCURRENTLY indexes — must run outside a transaction.
--   See Section 3 of the Phase-8.6 architecture document for rationale.
--
-- Partition note
--   api_access_logs is the highest-volume table in the system.
--   For schools with >200 students, monthly range partitioning on
--   created_at is recommended. See Section 4 of the architecture document.
--   This migration creates the table as unpartitioned; partition conversion
--   requires a table rewrite (zero-downtime path: create partitioned shadow
--   table → COPY → rename). Do not partition in-place without a maintenance
--   window.
-- ============================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Transactional schema changes
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── api_access_logs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_access_logs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tenant context — NULL for unauthenticated requests (login, health, docs)
  organization_id  UUID        NULL,
  user_id          UUID        NULL,
  -- Request identity
  method           VARCHAR(10) NOT NULL,
  path             TEXT        NOT NULL,
  -- Response metadata
  status_code      SMALLINT    NOT NULL,
  response_time_ms INTEGER     NULL CHECK (response_time_ms >= 0),
  bytes_sent       BIGINT      NULL CHECK (bytes_sent       >= 0),
  -- Client context
  ip_address       TEXT        NULL,
  user_agent       TEXT        NULL,
  -- Timestamp (always UTC — convert with AT TIME ZONE when needed)
  created_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE api_access_logs IS
  'HTTP request log — primary telemetry for Phase-8.6 behavioral risk signals. '
  'Written by API middleware; never blocks the request path (fire-and-forget insert). '
  'Retention target: 7–30 days. Prune via DELETE with LIMIT 5000 batches or '
  'by DROPping old monthly partitions when partitioning is enabled.';

COMMENT ON COLUMN api_access_logs.bytes_sent IS
  'Response body size in bytes. Used by EXPORT_SPIKE to detect large data '
  'transfers that do not match /export or /download path patterns '
  '(e.g. paginated student lists with very large page sizes).';

COMMENT ON COLUMN api_access_logs.path IS
  'URL path only — no query string, no scheme, no host. '
  'Stored as received; normalise to lowercase at insert time if routes '
  'can vary in case. Used with PostgreSQL ~* operator for family classification.';

-- ── school_risk_config extension ──────────────────────────────────────────────
-- Adds configurable large-response threshold for the EXPORT_SPIKE signal.
-- DEFAULT 1,048,576 = 1 MiB; set lower for schools with strict data policies.

ALTER TABLE school_risk_config
  ADD COLUMN IF NOT EXISTS large_bytes_threshold BIGINT NOT NULL DEFAULT 1048576
    CHECK (large_bytes_threshold > 0);

COMMENT ON COLUMN school_risk_config.large_bytes_threshold IS
  'Minimum response size in bytes that qualifies as a large data transfer '
  'for the EXPORT_SPIKE signal, regardless of endpoint path. Default: 1 MiB.';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — CONCURRENTLY indexes on api_access_logs
--
-- All three indexes carry partial predicates to exclude unauthenticated rows
-- (user_id IS NOT NULL / organization_id IS NOT NULL). This keeps index size
-- proportional to behaviorally-relevant traffic and avoids indexing noise from
-- health checks, docs, and unauthenticated probes.
--
-- Must run OUTSIDE a transaction block (PostgreSQL restriction for CONCURRENTLY).
-- IF NOT EXISTS guards make re-runs safe.
--
-- Do NOT add an index on (path) at this stage — regex (~*) cannot use a plain
-- B-tree index. If path-scan performance becomes a bottleneck at scale, enable
-- pg_trgm and add a GIN trigram index (see Section 3 of the architecture doc).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Index 1: Primary covering index ──────────────────────────────────────────
-- Covers ALL 5 signal detector queries:
--   • created_at > NOW() - INTERVAL '...' (time window)
--   • organization_id (tenant isolation + grouping)
--   • user_id (grouping + partial predicate)
-- Partial: only authenticated rows (user_id IS NOT NULL) — detectors filter
-- unauthenticated rows anyway, so including them wastes index space.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aal_org_user_time
  ON api_access_logs (organization_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- ── Index 2: Org-time index for traffic-level queries ────────────────────────
-- Covers org-level dashboard aggregations and SENSITIVE_CONCENTRATION
-- when querying across all users in an org:
--   SELECT ... FROM api_access_logs WHERE organization_id = $1 AND created_at > $2
-- Kept separate from Index 1 so the planner can choose based on selectivity.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aal_org_time
  ON api_access_logs (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;

-- ── Index 3: Bare created_at for time-range pruning ──────────────────────────
-- Supports scheduled cleanup:
--   DELETE FROM api_access_logs WHERE created_at < NOW() - INTERVAL '30 days'
-- Without this, a DELETE on a large table degrades to a sequential scan.
-- NOT partial — pruning applies to all rows including unauthenticated.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aal_created_at
  ON api_access_logs (created_at);
