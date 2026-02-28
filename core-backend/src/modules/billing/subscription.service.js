'use strict';

const pool   = require('../../config/db');
const logger = require('../../utils/logger');

// ── Internal metrics counter ──────────────────────────────────────────────────
// Tracks failed recordUsageEvent inserts within this process lifetime.
// Exposed via getFailedUsageInsertCount() for health checks / APM integration.
const _counters = { failedUsageInserts: 0 };

// ── Computed status derivation ────────────────────────────────────────────────
//
// The DB `status` column stores the billing-system lifecycle state.
// The service layer derives a `computedStatus` at query time based on
// the current timestamp, period end, and grace window. This keeps
// time-based transitions out of the DB and free from stale values.
//
// Computed status values:
//   TRIAL     — within trial period; plan limits apply
//   ACTIVE    — paid subscription, within billing period
//   GRACE     — past due but within grace window; access allowed
//   PAST_DUE  — payment failed, no grace window configured
//   SUSPENDED — manually blocked by platform admin
//   EXPIRED   — period ended, no active grace window
//   CANCELED  — explicitly terminated
//   NONE      — no subscription record found
//
function _computeStatus(row, now) {
  const dbStatus  = row.status;
  const periodEnd = new Date(row.current_period_end);
  const graceEnd  = row.grace_until ? new Date(row.grace_until) : null;

  if (dbStatus === 'CANCELED')  return 'CANCELED';
  if (dbStatus === 'SUSPENDED') return 'SUSPENDED';

  if (dbStatus === 'TRIAL') {
    return periodEnd > now ? 'TRIAL' : 'EXPIRED';
  }

  if (dbStatus === 'ACTIVE') {
    if (periodEnd > now)              return 'ACTIVE';
    if (graceEnd && graceEnd > now)   return 'GRACE';
    return 'EXPIRED';
  }

  if (dbStatus === 'PAST_DUE') {
    if (graceEnd && graceEnd > now)   return 'GRACE';
    return 'PAST_DUE'; // past due without a configured grace window
  }

  if (dbStatus === 'GRACE') {
    if (graceEnd && graceEnd > now)   return 'GRACE';
    return 'EXPIRED';
  }

  return 'EXPIRED'; // unknown DB state — safe default
}

// ── getActiveSubscription ─────────────────────────────────────────────────────
/**
 * Fetch the most recent non-canceled subscription for an org and compute its
 * real-time status.
 *
 * Returns:
 *   { computedStatus, subscription, plan }   — always on success (computedStatus may be 'NONE')
 *   null                                      — DB error (caller should fail-open)
 *
 * @param {string} organizationId
 * @returns {Promise<{ computedStatus: string, subscription: object|null, plan: object|null } | null>}
 */
async function getActiveSubscription(organizationId) {
  try {
    const { rows } = await pool.query(
      `SELECT
         ts.id,
         ts.organization_id,
         ts.plan_id,
         ts.status,
         ts.current_period_start,
         ts.current_period_end,
         ts.grace_until,
         ts.created_at,
         tp.name          AS plan_name,
         tp.limits_json,
         tp.features_json,
         tp.price_monthly
       FROM   tenant_subscriptions ts
       JOIN   tenant_plans         tp ON tp.id = ts.plan_id
       WHERE  ts.organization_id = $1
         AND  ts.status != 'CANCELED'
       ORDER  BY ts.created_at DESC
       LIMIT  1`,
      [organizationId]
    );

    if (rows.length === 0) {
      return { computedStatus: 'NONE', subscription: null, plan: null };
    }

    const row            = rows[0];
    const computedStatus = _computeStatus(row, new Date());

    return {
      computedStatus,
      subscription: {
        id:                 row.id,
        organizationId:     row.organization_id,
        planId:             row.plan_id,
        status:             row.status,         // raw DB status
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd:   row.current_period_end,
        graceUntil:         row.grace_until,
      },
      plan: {
        id:           row.plan_id,
        name:         row.plan_name,
        limits:       row.limits_json   || {},  // { max_users, max_messages, max_storage_mb, … }
        features:     row.features_json || {},  // { api_access, custom_reports, … }
        priceMonthly: Number(row.price_monthly),
      },
    };
  } catch (err) {
    logger.warn('SubscriptionService: getActiveSubscription failed', {
      organizationId,
      error: err.message,
    });
    return null; // signal DB error — middleware will fail-open
  }
}

// ── recordUsageEvent ──────────────────────────────────────────────────────────
/**
 * Append a single usage event. Always fail-open: DB errors increment an
 * internal counter and are logged but never thrown to the caller.
 *
 * Compatible with background aggregation: usage_events rows are read by a
 * separate worker that upserts into usage_summary_period.
 *
 * @param {object} data
 * @param {string} data.organizationId
 * @param {string} data.metric    e.g. 'MESSAGES_SENT', 'USERS_ACTIVE', 'STORAGE_MB'
 * @param {number} data.amount    Positive integer
 * @returns {Promise<void>}
 */
async function recordUsageEvent({ organizationId, metric, amount }) {
  try {
    await pool.query(
      `INSERT INTO usage_events (organization_id, metric, amount)
       VALUES ($1, $2, $3)`,
      [organizationId, metric, amount]
    );
  } catch (err) {
    _counters.failedUsageInserts += 1;
    logger.warn('SubscriptionService: recordUsageEvent failed', {
      organizationId,
      metric,
      amount,
      failedInsertCount: _counters.failedUsageInserts,
      error: err.message,
    });
    // Never throw — caller continues regardless.
  }
}

// ── getCurrentUsage ───────────────────────────────────────────────────────────
/**
 * Returns per-metric usage totals for the current billing period.
 *
 * Read strategy (optimised for latency):
 *   1. Try usage_summary_period — O(1) lookup when background aggregator
 *      has already summarised this period.
 *   2. Fall back to SUM over usage_events — correct but O(n) on raw events.
 *      This path is taken on the first request of any new billing period,
 *      before the aggregator has run.
 *
 * @param {string}       organizationId
 * @param {Date|string}  periodStart    Subscription's current_period_start
 * @returns {Promise<object>}  { MESSAGES_SENT: 450, USERS_ACTIVE: 3, … }
 *                              Empty object {} on DB error or no events.
 */
async function getCurrentUsage(organizationId, periodStart) {
  try {
    // ── Primary: pre-aggregated summary ──────────────────────────────────────
    const { rows: summaryRows } = await pool.query(
      `SELECT metric, total_amount
       FROM   usage_summary_period
       WHERE  organization_id = $1
         AND  period_start    = $2`,
      [organizationId, periodStart]
    );

    if (summaryRows.length > 0) {
      return Object.fromEntries(
        summaryRows.map((r) => [r.metric, Number(r.total_amount)])
      );
    }

    // ── Fallback: raw event aggregation ──────────────────────────────────────
    const { rows: eventRows } = await pool.query(
      `SELECT metric, SUM(amount) AS total
       FROM   usage_events
       WHERE  organization_id = $1
         AND  occurred_at    >= $2
       GROUP  BY metric`,
      [organizationId, periodStart]
    );

    return Object.fromEntries(
      eventRows.map((r) => [r.metric, Number(r.total)])
    );
  } catch (err) {
    logger.warn('SubscriptionService: getCurrentUsage failed', {
      organizationId,
      error: err.message,
    });
    return {}; // empty usage — middleware will fail-open on usage check
  }
}

// ── Diagnostics ───────────────────────────────────────────────────────────────
/**
 * Returns the count of failed recordUsageEvent inserts since process start.
 * Expose via a health-check endpoint or APM integration.
 */
function getFailedUsageInsertCount() {
  return _counters.failedUsageInserts;
}

module.exports = {
  getActiveSubscription,
  recordUsageEvent,
  getCurrentUsage,
  getFailedUsageInsertCount,
};
