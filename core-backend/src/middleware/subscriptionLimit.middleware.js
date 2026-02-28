'use strict';

const {
  getActiveSubscription,
  getCurrentUsage,
} = require('../modules/billing/subscription.service');

const logger = require('../utils/logger');

// ── Metrics checked against plan limits ──────────────────────────────────────
// Each entry maps a usage_events.metric value to the corresponding key in
// plan.limits_json. If a limit key is absent from the plan's limits_json,
// that metric is not enforced (i.e., unlimited for that plan).
const LIMIT_CHECKS = [
  { metric: 'MESSAGES_SENT', limitKey: 'max_messages' },
  { metric: 'USERS_ACTIVE',  limitKey: 'max_users'    },
];

// ── Decision table ────────────────────────────────────────────────────────────
//
// computedStatus  | action
// ─────────────── | ─────────────────────────────────────────────────
// NONE            | 402 — no subscription found (no implicit trial)
// CANCELED        | 402 — subscription canceled
// SUSPENDED       | 402 — manually suspended by platform admin
// EXPIRED         | 402 — period ended, grace window (if any) elapsed
// PAST_DUE        | 402 — payment missed, no grace window configured
// GRACE           | next() — grace period: full access, skip limit checks
// TRIAL           | limit check → next() or 402
// ACTIVE          | limit check → next() or 402
//
// DB error        | logger.warn → next() (fail-open: infra error ≠ access denied)
// Usage DB error  | logger.warn → next() (fail-open on usage lookup only)
//

module.exports = async function subscriptionLimitMiddleware(req, res, next) {
  // organizationId MUST come from the verified JWT — never from params or body.
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    // Belt-and-suspenders: verifyToken should always set this before us.
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  // ── 1. Fetch subscription ─────────────────────────────────────────────────
  let result;
  try {
    result = await getActiveSubscription(organizationId);
  } catch (err) {
    // getActiveSubscription returns null on DB errors and never throws,
    // but guard here for absolute safety.
    logger.warn('SubscriptionLimit: unexpected error — allowing (fail-open)', {
      organizationId,
      error: err.message,
    });
    return next();
  }

  // null → DB error inside the service; fail-open
  if (result === null) {
    logger.warn('SubscriptionLimit: service returned null (DB error) — allowing (fail-open)', {
      organizationId,
    });
    return next();
  }

  const { computedStatus, subscription, plan } = result;

  // ── 2. No subscription ────────────────────────────────────────────────────
  // Explicit block — no implicit trial mode when subscription is absent.
  if (computedStatus === 'NONE') {
    return res.status(402).json({
      success: false,
      message: 'No active subscription found',
    });
  }

  // ── 3. Hard-block statuses ────────────────────────────────────────────────
  if (computedStatus === 'SUSPENDED') {
    return res.status(402).json({
      success: false,
      message: 'Subscription suspended',
    });
  }

  if (computedStatus === 'CANCELED') {
    return res.status(402).json({
      success: false,
      message: 'Subscription canceled',
    });
  }

  if (computedStatus === 'EXPIRED') {
    return res.status(402).json({
      success: false,
      message: 'Subscription expired',
    });
  }

  if (computedStatus === 'PAST_DUE') {
    // PAST_DUE with no grace window configured — payment missed, deny access.
    return res.status(402).json({
      success: false,
      message: 'Subscription payment is past due',
    });
  }

  // ── 4. GRACE — allow full access, skip limit checks ──────────────────────
  // During the grace window the org retains full access so they can resolve
  // payment issues without service disruption.
  if (computedStatus === 'GRACE') {
    return next();
  }

  // ── 5. TRIAL / ACTIVE — enforce plan limits ───────────────────────────────
  // Both trial and paid subscriptions are subject to their plan's limits_json.
  // Trial is NOT a free pass — it has limits like any other plan.
  const limits = plan?.limits || {};
  const usage  = await getCurrentUsage(organizationId, subscription.currentPeriodStart);
  // getCurrentUsage returns {} on DB error (fail-open for usage check only)

  for (const { metric, limitKey } of LIMIT_CHECKS) {
    const limit = limits[limitKey];
    if (limit == null) continue; // limit not defined for this plan → unlimited

    const used = usage[metric] ?? 0;

    if (used > limit) {
      logger.info('SubscriptionLimit: limit exceeded', {
        organizationId,
        computedStatus,
        metric,
        used,
        limit,
      });
      return res.status(402).json({
        success: false,
        message: 'Subscription limit reached',
        metric,
        used,
        limit,
      });
    }
  }

  return next();
};
