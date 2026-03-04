'use strict';

/**
 * endpointFriction.service.js
 *
 * Phase-9.B — Endpoint Friction Hardening.
 *
 * Exports:
 *   ENDPOINT_GROUPS            — registry of valid endpoint group keys
 *   evaluateEndpointFriction   — pure constant-time guard (read-only)
 *   evaluateRiskForVerify      — two-query check used by /security/verify
 *   mintStepUpToken            — UPSERT into endpoint_stepup_tokens
 *
 * Guard invariants (evaluateEndpointFriction):
 *   1. Always executes all three DB queries — no early returns.
 *   2. No writes. No logging. No external calls. Pure function.
 *   3. Fail-open: any DB error on any query → ALLOW.
 *      Never BLOCK from a DB outage.
 *   4. Never exposes risk score in return value.
 *   5. Every query is scoped to organization_id (tenant isolation).
 *
 * Friction decision matrix:
 *   risk_level = NORMAL, or no user_risk_state row   → ALLOW (no policy applicable)
 *   policy row absent for (org, risk_level, group)   → ALLOW (default permissive)
 *   policy.friction_action = 'ALLOW'                 → ALLOW
 *   policy.friction_action = 'BLOCK'                 → BLOCKED
 *   policy.friction_action = 'STEPUP' + valid token  → ALLOW
 *   policy.friction_action = 'STEPUP' + no token     → STEPUP_REQUIRED
 *
 * Fail-open matrix:
 *   Token lookup fails   → treat as no token
 *   Risk lookup fails    → treat as NORMAL risk
 *   Policy lookup fails  → treat as absent policy (ALLOW)
 *   Any single failure   → overall result: ALLOW
 */

const pool = require('../config/db');

// ── Endpoint group registry ───────────────────────────────────────────────────
// Authoritative list of valid endpoint_group keys.
// Guards and /security/verify validate against this registry.
// Add new groups here; they become available for policy configuration immediately.
//
// defaultTtlMinutes: fallback TTL used by mintStepUpToken when the
// org_risk_friction_policy row does not specify a token_ttl_minutes value
// (e.g. for a STEPUP action without a policy row — should not happen in
// practice but the service handles it defensively).

const ENDPOINT_GROUPS = new Map([
  ['student.read',   { label: 'Student record read access',       defaultTtlMinutes: 60  }],
  ['student.export', { label: 'Student data export',              defaultTtlMinutes: 30  }],
  ['finance.read',   { label: 'Financial record read access',     defaultTtlMinutes: 60  }],
  ['finance.export', { label: 'Financial data export',            defaultTtlMinutes: 30  }],
  ['reports.export', { label: 'Report generation and export',     defaultTtlMinutes: 30  }],
  ['users.admin',    { label: 'User administration operations',   defaultTtlMinutes: 120 }],
]);

// ── Risk level ordering ───────────────────────────────────────────────────────
// NORMAL is included so that a user_risk_state row at NORMAL can be
// compared correctly (result: ALLOW — no policy applies to NORMAL).

const LEVEL_ORDER = { NORMAL: 0, ELEVATED: 1, HIGH: 2, CRITICAL: 3 };

// ── Application error factory ─────────────────────────────────────────────────

function _appError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// ── Pure constant-time guard ──────────────────────────────────────────────────

/**
 * evaluateEndpointFriction({ organizationId, userId, endpointGroup })
 *
 * Pure, read-only friction guard.  Always executes exactly three DB queries
 * in sequence regardless of intermediate results (constant-time execution —
 * no early returns after any query, preventing timing side-channels that
 * could reveal a user's risk level to an observer).
 *
 * Execution sequence:
 *   Query 1: endpoint_stepup_tokens  — does a valid token exist?
 *   Query 2: user_risk_state         — what is the user's current risk level?
 *   Query 3: org_risk_friction_policy — what is the org's rule for this combination?
 *
 * Decision is computed AFTER all three queries complete.
 *
 * NEVER throws. Returns ALLOW on any DB error.
 * NEVER writes to any table.
 * NEVER logs. Callers (middleware) log after receiving the result.
 * NEVER exposes risk_score in the return value.
 *
 * @param {{ organizationId: string, userId: string, endpointGroup: string }} params
 * @returns {Promise<{
 *   decision:  'ALLOW' | 'STEPUP_REQUIRED' | 'BLOCKED',
 *   failOpen:  boolean,   // true if one or more DB queries failed
 * }>}
 */
async function evaluateEndpointFriction({ organizationId, userId, endpointGroup }) {
  let tokenRow  = null;
  let riskRow   = null;
  let policyRow = null;
  let anyError  = false;

  // ── Query 1: endpoint_stepup_tokens lookup ─────────────────────────────────
  // Check for a live (non-expired) step-up token for this (org, user, group).
  // Failure → treat as no token (anyError flag set → ALLOW at decision time).
  //
  // No early return here, even if a valid token is found.

  try {
    const { rows } = await pool.query(
      `SELECT expires_at
         FROM endpoint_stepup_tokens
        WHERE organization_id = $1
          AND user_id         = $2
          AND endpoint_group  = $3
          AND expires_at      > NOW()`,
      [organizationId, userId, endpointGroup]
    );
    tokenRow = rows[0] || null;
  } catch (_) {
    anyError = true;
  }

  // ── Query 2: user_risk_state lookup ───────────────────────────────────────
  // Fetch the user's current risk_level (NOT peak — friction is dynamic).
  // Failure → treat as NORMAL (anyError → ALLOW at decision time).

  try {
    const { rows } = await pool.query(
      `SELECT risk_level
         FROM user_risk_state
        WHERE organization_id = $1
          AND user_id         = $2`,
      [organizationId, userId]
    );
    riskRow = rows[0] || null;
  } catch (_) {
    anyError = true;
  }

  // ── Query 3: org_risk_friction_policy lookup ──────────────────────────────
  // Look up the friction rule for (org, current_risk_level, endpoint_group).
  // Uses the risk_level from Query 2 (or 'NORMAL' if Query 2 failed/empty).
  // Failure → treat as absent policy (anyError → ALLOW at decision time).
  //
  // The query still executes even when:
  //   - Query 1 returned a valid token (early return would leak timing)
  //   - Query 2 found NORMAL risk (policy lookup result won't be used, but
  //     executing it maintains a uniform query pattern across all callers)

  const currentRiskLevel = (riskRow && riskRow.risk_level) ? riskRow.risk_level : 'NORMAL';

  try {
    const { rows } = await pool.query(
      `SELECT friction_action, token_ttl_minutes
         FROM org_risk_friction_policy
        WHERE organization_id = $1
          AND risk_level       = $2
          AND endpoint_group   = $3`,
      [organizationId, currentRiskLevel, endpointGroup]
    );
    policyRow = rows[0] || null;
  } catch (_) {
    anyError = true;
  }

  // ── Decision (all queries complete) ───────────────────────────────────────
  // Fail-open: any DB error → ALLOW. Never BLOCK from DB unavailability.

  if (anyError) {
    return { decision: 'ALLOW', failOpen: true };
  }

  // No risk state or user is at NORMAL → no policy applicable → ALLOW.
  if (!riskRow || (LEVEL_ORDER[riskRow.risk_level] || 0) === 0) {
    return { decision: 'ALLOW', failOpen: false };
  }

  // No policy row for (org, risk_level, group) → default permissive → ALLOW.
  if (!policyRow) {
    return { decision: 'ALLOW', failOpen: false };
  }

  const action = policyRow.friction_action;

  if (action === 'ALLOW') {
    return { decision: 'ALLOW', failOpen: false };
  }

  if (action === 'BLOCK') {
    return { decision: 'BLOCKED', failOpen: false };
  }

  // action === 'STEPUP'
  if (tokenRow) {
    return { decision: 'ALLOW', failOpen: false };
  }

  return { decision: 'STEPUP_REQUIRED', failOpen: false };
}

// ── Risk evaluation for /security/verify ─────────────────────────────────────

/**
 * evaluateRiskForVerify({ organizationId, userId, endpointGroup })
 *
 * Two-query risk check used exclusively by POST /security/verify.
 * Intentionally does NOT look up endpoint_stepup_tokens — the verify
 * flow IS the step-up process; existing tokens are irrelevant to
 * deciding whether to mint a new one.
 *
 * Returns the friction_action and token TTL the org has configured, or
 * sensible defaults when no policy row exists (permissive + registry TTL).
 *
 * Fail-open: DB errors → { action: 'ALLOW', ttlMinutes: default }.
 * BLOCK is respected — the verify endpoint refuses to mint tokens for
 * BLOCKED users.
 *
 * @param {{ organizationId: string, userId: string, endpointGroup: string }} params
 * @returns {Promise<{
 *   action:      'ALLOW' | 'STEPUP' | 'BLOCK',
 *   ttlMinutes:  number,
 *   failOpen:    boolean,
 * }>}
 */
async function evaluateRiskForVerify({ organizationId, userId, endpointGroup }) {
  const registryEntry  = ENDPOINT_GROUPS.get(endpointGroup);
  const defaultTtl     = registryEntry ? registryEntry.defaultTtlMinutes : 60;

  let riskRow   = null;
  let policyRow = null;
  let anyError  = false;

  // Query 1: current risk level (no token lookup — intentional)
  try {
    const { rows } = await pool.query(
      `SELECT risk_level
         FROM user_risk_state
        WHERE organization_id = $1
          AND user_id         = $2`,
      [organizationId, userId]
    );
    riskRow = rows[0] || null;
  } catch (_) {
    anyError = true;
  }

  const currentRiskLevel = (riskRow && riskRow.risk_level) ? riskRow.risk_level : 'NORMAL';

  // Query 2: friction policy for (org, risk_level, group)
  try {
    const { rows } = await pool.query(
      `SELECT friction_action, token_ttl_minutes
         FROM org_risk_friction_policy
        WHERE organization_id = $1
          AND risk_level       = $2
          AND endpoint_group   = $3`,
      [organizationId, currentRiskLevel, endpointGroup]
    );
    policyRow = rows[0] || null;
  } catch (_) {
    anyError = true;
  }

  // Fail-open on DB error
  if (anyError) {
    return { action: 'ALLOW', ttlMinutes: defaultTtl, failOpen: true };
  }

  // NORMAL risk or no state row → no policy applicable → mint freely
  if (!riskRow || (LEVEL_ORDER[riskRow.risk_level] || 0) === 0) {
    return { action: 'ALLOW', ttlMinutes: defaultTtl, failOpen: false };
  }

  // No policy row → default permissive
  if (!policyRow) {
    return { action: 'ALLOW', ttlMinutes: defaultTtl, failOpen: false };
  }

  return {
    action:     policyRow.friction_action,
    ttlMinutes: policyRow.token_ttl_minutes || defaultTtl,
    failOpen:   false,
  };
}

// ── Token minting ─────────────────────────────────────────────────────────────

/**
 * mintStepUpToken({ organizationId, userId, endpointGroup, ttlMinutes })
 *
 * UPSERT a step-up token for (org, user, endpoint_group).
 *
 * Uses INSERT … ON CONFLICT (organization_id, user_id, endpoint_group)
 * DO UPDATE to atomically refresh the token in-place.  Never delete-insert.
 *
 * The UNIQUE constraint on (organization_id, user_id, endpoint_group) in
 * endpoint_stepup_tokens is the ON CONFLICT target.
 *
 * @param {{ organizationId: string, userId: string, endpointGroup: string, ttlMinutes: number }} params
 * @returns {Promise<{ expiresAt: Date }>}
 * @throws {Error} with .status on DB failure
 */
async function mintStepUpToken({ organizationId, userId, endpointGroup, ttlMinutes }) {
  const { rows } = await pool.query(
    `INSERT INTO endpoint_stepup_tokens
       (organization_id, user_id, endpoint_group, issued_at, expires_at)
     VALUES (
       $1, $2, $3,
       NOW(),
       NOW() + ($4 * INTERVAL '1 minute')
     )
     ON CONFLICT (organization_id, user_id, endpoint_group)
     DO UPDATE SET
       issued_at  = NOW(),
       expires_at = NOW() + ($4 * INTERVAL '1 minute')
     RETURNING expires_at`,
    [organizationId, userId, endpointGroup, ttlMinutes]
  );

  if (rows.length === 0) {
    throw _appError('TOKEN_MINT_FAILED', 500);
  }

  return { expiresAt: rows[0].expires_at };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ENDPOINT_GROUPS,
  evaluateEndpointFriction,
  evaluateRiskForVerify,
  mintStepUpToken,
};
