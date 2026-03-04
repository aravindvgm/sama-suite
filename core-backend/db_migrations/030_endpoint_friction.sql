-- ============================================================
-- MIGRATION 030: Phase-9.B Endpoint Friction Hardening
-- ============================================================
--
-- Adds the graduated enforcement layer between behavioral risk
-- signals and protected API endpoints.
--
-- Tables created:
--   endpoint_stepup_tokens    — per (org, user, endpoint_group) clearance
--                               tokens. Minted by POST /security/verify;
--                               consumed (read-only) by the friction guard.
--
--   org_risk_friction_policy  — per-org matrix mapping (risk_level,
--                               endpoint_group) → friction_action and TTL.
--                               ALLOW: pass through.
--                               STEPUP: require a valid step-up token.
--                               BLOCK: hard reject regardless of tokens.
--
-- Design invariants:
--   • The friction guard (evaluateEndpointFriction) is READ-ONLY.
--     It never writes to either table.
--   • Only POST /security/verify writes to endpoint_stepup_tokens
--     via the UPSERT path (INSERT ON CONFLICT DO UPDATE).
--   • BLOCK decisions are never issued purely from a DB outage
--     (fail-open — see service layer).
--   • No PII is stored in either table.
--
-- Phase 1 — transactional DDL (BEGIN / COMMIT)
-- Phase 2 — CONCURRENTLY indexes (outside transaction)
-- ============================================================


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Transactional schema changes
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── endpoint_stepup_tokens ────────────────────────────────────────────────────
-- One row per (organization_id, user_id, endpoint_group).
-- The UNIQUE constraint is the ON CONFLICT target for the UPSERT in /verify.
-- Rows expire naturally (expires_at) and are pruned by a scheduled job.
-- The guard checks expires_at > NOW() at query time — no hard deletes required
-- for correctness (expired rows are inert).

CREATE TABLE IF NOT EXISTS endpoint_stepup_tokens (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,
  user_id          UUID        NOT NULL,

  -- Endpoint group key — must match a value in the ENDPOINT_GROUPS registry
  -- in endpointFriction.service.js.  Stored as-is; validated at the service
  -- layer before insert.  Example values: 'student.export', 'finance.read'.
  endpoint_group   VARCHAR(50) NOT NULL,

  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL,

  -- One active token per (org, user, group) at a time.
  -- UPSERT refreshes issued_at + expires_at in place; never delete-insert.
  UNIQUE (organization_id, user_id, endpoint_group),

  -- Sanity constraint: token must expire in the future when written.
  -- The guard adds AND expires_at > NOW() at read time; this prevents
  -- accidentally writing already-expired rows.
  CONSTRAINT chk_est_expires_after_issued CHECK (expires_at > issued_at)
);

COMMENT ON TABLE endpoint_stepup_tokens IS
  'Step-up clearance tokens for Phase-9.B endpoint friction. '
  'One row per (org, user, endpoint_group). Written ONLY by POST /security/verify '
  'via UPSERT. Read ONLY by evaluateEndpointFriction (pure, no writes). '
  'Expired rows are inert; prune with DELETE WHERE expires_at < NOW() LIMIT N.';

COMMENT ON COLUMN endpoint_stepup_tokens.endpoint_group IS
  'Endpoint group key from the ENDPOINT_GROUPS registry '
  '(endpointFriction.service.js). Examples: student.export, finance.read.';

COMMENT ON COLUMN endpoint_stepup_tokens.expires_at IS
  'UTC timestamp after which this token is invalid. The guard applies '
  'AND expires_at > NOW() at read time. TTL source: org_risk_friction_policy. '
  'token_ttl_minutes for the matching (risk_level, endpoint_group) row, '
  'or the ENDPOINT_GROUPS registry default if no policy row exists.';


-- ── org_risk_friction_policy ──────────────────────────────────────────────────
-- Friction action matrix.  One row per (organization_id, risk_level,
-- endpoint_group) triple.  Absent row = ALLOW for that combination.
--
-- token_ttl_minutes: valid only when friction_action = 'STEPUP'.
-- Defines how long a step-up token lasts for this (level, group) combination.
-- Tighter TTLs for high-risk + sensitive endpoints.

CREATE TABLE IF NOT EXISTS org_risk_friction_policy (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL,

  -- Risk level that triggers this policy row.
  -- Matches user_risk_state.risk_level (current level, not peak).
  risk_level       VARCHAR(10) NOT NULL
                     CHECK (risk_level IN ('ELEVATED', 'HIGH', 'CRITICAL')),

  -- Endpoint group this rule applies to.
  endpoint_group   VARCHAR(50) NOT NULL,

  -- Action to enforce when the user's risk_level matches and no valid
  -- step-up token exists.
  --   ALLOW  — pass through regardless of risk level (whitelist override).
  --   STEPUP — require a valid endpoint_stepup_tokens row for this group.
  --   BLOCK  — hard 403; token minting also refused at /security/verify.
  friction_action  VARCHAR(10) NOT NULL
                     CHECK (friction_action IN ('ALLOW', 'STEPUP', 'BLOCK')),

  -- How long a freshly minted step-up token lasts (seconds converted from
  -- minutes).  Ignored when friction_action != 'STEPUP'.
  -- Defaults to 60 minutes.  Range: 5–1440 (5 min to 24 h).
  token_ttl_minutes INTEGER    NOT NULL DEFAULT 60
                     CHECK (token_ttl_minutes BETWEEN 5 AND 1440),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One rule per (org, risk_level, endpoint_group) combination.
  -- ON CONFLICT can be used for upsert when admins update policies.
  UNIQUE (organization_id, risk_level, endpoint_group)
);

COMMENT ON TABLE org_risk_friction_policy IS
  'Friction action matrix for Phase-9.B. One row per (org, risk_level, '
  'endpoint_group). Absent row = ALLOW for that combination. '
  'Read ONLY by evaluateEndpointFriction; never written by the guard. '
  'Managed via admin API.';

COMMENT ON COLUMN org_risk_friction_policy.friction_action IS
  'ALLOW: pass through (whitelist override). '
  'STEPUP: require a valid endpoint_stepup_tokens row; user must visit '
  'POST /security/verify to mint a token. '
  'BLOCK: hard 403 at all times; /security/verify also refuses to mint.';

COMMENT ON COLUMN org_risk_friction_policy.token_ttl_minutes IS
  'TTL for newly minted step-up tokens (minutes). Used only when '
  'friction_action = STEPUP. Shorter TTLs for sensitive endpoint groups '
  'reduce the blast radius of a stolen token. Range: 5–1440.';

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — CONCURRENTLY indexes
--
-- All must run OUTSIDE a transaction block (PostgreSQL restriction for CONCURRENTLY).
-- IF NOT EXISTS guards make re-runs safe.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── endpoint_stepup_tokens ────────────────────────────────────────────────────

-- Primary lookup index for the friction guard:
--   SELECT expires_at FROM endpoint_stepup_tokens
--   WHERE organization_id=$1 AND user_id=$2 AND endpoint_group=$3 AND expires_at>NOW()
-- The UNIQUE index created inline already covers (org, user, group) lookups.
-- This additional index adds created_at DESC for the prune job query:
--   DELETE WHERE expires_at < NOW() ORDER BY expires_at
-- Partial: only live (unexpired) tokens are read by the guard; expired tokens
-- are inert. Index on unexpired rows keeps lookup cost near-zero.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_est_org_user_group_live
  ON endpoint_stepup_tokens (organization_id, user_id, endpoint_group)
  WHERE expires_at > NOW();

-- Prune index: DELETE WHERE expires_at < NOW() LIMIT N
-- Without this, the prune job degrades to a sequential scan on large tables.
-- NOT partial — covers all rows including expired ones (the rows to be pruned).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_est_expires_at
  ON endpoint_stepup_tokens (expires_at);


-- ── org_risk_friction_policy ──────────────────────────────────────────────────

-- Third query in the constant-time guard:
--   SELECT friction_action, token_ttl_minutes FROM org_risk_friction_policy
--   WHERE organization_id=$1 AND risk_level=$2 AND endpoint_group=$3
-- The UNIQUE constraint already creates an implicit B-tree index on
-- (organization_id, risk_level, endpoint_group), which the planner uses for
-- this equality lookup.  No additional index is needed.
-- (Index is shown here as a comment to document the decision explicitly.)
--   Covered by: UNIQUE (organization_id, risk_level, endpoint_group) → implicit index.
