'use strict';

/**
 * securityObservability.service.js
 *
 * Phase-8 Security Observability — signal collection and anomaly detection.
 *
 * Produces low-noise structured warning logs from existing audit tables.
 * NEVER blocks requests, NEVER changes auth outcomes.
 * Safe across multiple Node instances (duplicate logs are acceptable).
 *
 * ┌─────┬────────────────────────────────┬──────────────┬─────────────┬──────────────────────────────┐
 * │  #  │ Signal                         │ Source table │ Window      │ Threshold                    │
 * ├─────┼────────────────────────────────┼──────────────┼─────────────┼──────────────────────────────┤
 * │  1  │ refresh_reuse_spike            │ ssa          │ 1 hour      │ > 3 reuse events / user+org  │
 * │  2  │ session_eviction_spike         │ ssa          │ 1 hour      │ > 10 evictions / user+org    │
 * │  3  │ permission_denied_burst        │ audit_logs   │ 5 minutes   │ > 20 denials / user+org      │
 * │  4  │ login_abuse_pattern            │ rla          │ 15 minutes  │ > 5 login hits / IP          │
 * │  5  │ refresh_burst_rate             │ sessions     │ 10 minutes  │ > 30 new sessions / user+org │
 * │  6  │ org_traffic_spike              │ rla          │ 15 min vs   │ current > 5× baseline        │
 * │     │                               │              │ prior 15min │                              │
 * │  7  │ suspicious_ip_spread           │ sessions     │ 10 minutes  │ > 5 distinct IPs / user+org  │
 * └─────┴────────────────────────────────┴──────────────┴─────────────┴──────────────────────────────┘
 *
 * Abbreviations: ssa = session_security_audit, rla = rate_limit_audit
 */

const pool   = require('../config/db');
const logger = require('../utils/logger');

// ─── Thresholds ───────────────────────────────────────────────────────────────
//
// Threshold rationale:
//
// Signal 1 (reuse, > 3 / 1 h):
//   Even 1 reuse event indicates a rotated token was re-played.
//   Threshold of 3 filters transient network retries while still catching
//   systematic replays (compromised device, token theft).
//
// Signal 2 (eviction, > 10 / 1 h):
//   Normal users do not swap between 10+ devices per hour.
//   High eviction rate suggests credential sharing (e.g. shared account)
//   or an automated client with broken session handling.
//
// Signal 3 (permission denied, > 20 / 5 min):
//   A misconfigured UI might cause a handful of 403s; 20+ in 5 minutes
//   suggests permission probing or a severely misconfigured integration.
//
// Signal 4 (login rate limit hits, > 5 / 15 min from one IP):
//   5 rate-limited login bursts from the same IP indicates persistent
//   credential stuffing rather than a single mis-typed password.
//
// Signal 5 (refresh burst, > 30 sessions / 10 min):
//   A 15-minute access token means a well-behaved client refreshes once
//   every 15 minutes. 30+ new sessions in 10 minutes implies a retry storm,
//   token misuse, or an automated tool hammering the refresh endpoint.
//
// Signal 6 (org traffic spike, 5× baseline):
//   Comparing current 15 minutes to prior 15 minutes. A 5× spike is
//   aggressive enough to filter normal day-to-day traffic variation while
//   catching sudden volume anomalies (DDoS, scripted scraping).
//
// Signal 7 (IP spread, > 5 unique IPs / 10 min):
//   Five distinct IPs within 10 minutes for the same user is a basic
//   impossible-travel heuristic. Catches session-hijacking across locations.

const THRESHOLDS = {
  REUSE_COUNT:     3,
  EVICTION_COUNT:  10,
  DENIED_COUNT:    20,
  LOGIN_HIT_COUNT: 5,
  REFRESH_COUNT:   30,
  ORG_SPIKE_RATIO: 5,
  IP_SPREAD_COUNT: 5,
};

// ─── Signal emitter ───────────────────────────────────────────────────────────

/**
 * Emits a structured security signal as a logger.warn entry.
 *
 * @param {string} signal   Machine-readable signal name (e.g. 'refresh_reuse_spike')
 * @param {object} details  All context fields for the signal
 */
function _emitSignal(signal, details) {
  logger.warn('SECURITY_SIGNAL', {
    signal,
    detectedAt: new Date().toISOString(),
    ...details,
  });
}

// ─── Signal 1: Refresh Reuse Spike ───────────────────────────────────────────

/**
 * Detects when refresh_reuse_detected events exceed 3 for the same user+org
 * within the past hour. Even 1 reuse indicates token replay; 3+ in an hour
 * suggests systematic attack or compromised credential storage.
 *
 * Index path: idx_ssa_created_at → filtered on reason → grouped.
 */
async function detectRefreshReuseSpike() {
  const { rows } = await pool.query(
    `SELECT user_id,
            organization_id,
            COUNT(*) AS reuse_count
     FROM   session_security_audit
     WHERE  reason     = 'refresh_reuse_detected'
       AND  created_at >= NOW() - INTERVAL '1 hour'
     GROUP BY user_id, organization_id
     HAVING COUNT(*) > $1`,
    [THRESHOLDS.REUSE_COUNT],
  );

  for (const row of rows) {
    _emitSignal('refresh_reuse_spike', {
      userId:         row.user_id,
      organizationId: row.organization_id,
      count:          parseInt(row.reuse_count, 10),
      window:         '1h',
      threshold:      THRESHOLDS.REUSE_COUNT,
      severity:       'HIGH',
      detail:         'Repeated refresh token reuse detected — possible credential theft or session hijacking',
    });
  }

  return rows.length;
}

// ─── Signal 2: Concurrent Session Eviction Spike ─────────────────────────────

/**
 * Detects excessive session eviction for the same user+org within the past hour.
 * Sustained evictions suggest credential sharing (multiple simultaneous users)
 * or a broken client that creates sessions without managing them.
 *
 * Index path: idx_ssa_created_at → filtered on reason → grouped.
 */
async function detectSessionEvictionSpike() {
  const { rows } = await pool.query(
    `SELECT user_id,
            organization_id,
            COUNT(*) AS eviction_count
     FROM   session_security_audit
     WHERE  reason     = 'concurrent_session_evicted'
       AND  created_at >= NOW() - INTERVAL '1 hour'
     GROUP BY user_id, organization_id
     HAVING COUNT(*) > $1`,
    [THRESHOLDS.EVICTION_COUNT],
  );

  for (const row of rows) {
    _emitSignal('session_eviction_spike', {
      userId:         row.user_id,
      organizationId: row.organization_id,
      count:          parseInt(row.eviction_count, 10),
      window:         '1h',
      threshold:      THRESHOLDS.EVICTION_COUNT,
      severity:       'MEDIUM',
      detail:         'Unusual session eviction rate — possible credential sharing or broken client',
    });
  }

  return rows.length;
}

// ─── Signal 3: Permission Denied Burst ───────────────────────────────────────

/**
 * Detects a burst of PERMISSION_DENIED events for the same user+org within
 * the past 5 minutes. Sources from audit_logs (action = 'PERMISSION_DENIED').
 *
 * Note: audit_logs.action is VARCHAR(50) since migration 020.
 * If no PERMISSION_DENIED rows exist, the query safely returns empty.
 *
 * Index path: idx_audit_org_created covers (organization_id, created_at DESC).
 * Cross-org scan benefits from created_at range reducing the working set.
 */
async function detectPermissionDeniedBurst() {
  const { rows } = await pool.query(
    `SELECT actor_user_id    AS user_id,
            organization_id,
            COUNT(*)         AS denied_count
     FROM   audit_logs
     WHERE  action     = 'PERMISSION_DENIED'
       AND  created_at >= NOW() - INTERVAL '5 minutes'
     GROUP BY actor_user_id, organization_id
     HAVING COUNT(*) > $1`,
    [THRESHOLDS.DENIED_COUNT],
  );

  for (const row of rows) {
    _emitSignal('permission_denied_burst', {
      userId:         row.user_id,
      organizationId: row.organization_id,
      count:          parseInt(row.denied_count, 10),
      window:         '5m',
      threshold:      THRESHOLDS.DENIED_COUNT,
      severity:       'MEDIUM',
      detail:         'High permission denial rate — possible access probing or severely misconfigured client',
    });
  }

  return rows.length;
}

// ─── Signal 4: Login Abuse Pattern ───────────────────────────────────────────

/**
 * Detects IPs that have triggered the login rate limiter more than 5 times
 * within the past 15 minutes. Persistent hits from the same IP after receiving
 * 429s indicates automated credential stuffing rather than accidental mis-types.
 *
 * Index path: idx_rla_ip + idx_rla_created_at.
 */
async function detectLoginAbuse() {
  const { rows } = await pool.query(
    `SELECT ip_address,
            organization_id,
            COUNT(*) AS hit_count
     FROM   rate_limit_audit
     WHERE  rate_limit_type = 'login'
       AND  created_at     >= NOW() - INTERVAL '15 minutes'
     GROUP BY ip_address, organization_id
     HAVING COUNT(*) > $1`,
    [THRESHOLDS.LOGIN_HIT_COUNT],
  );

  for (const row of rows) {
    _emitSignal('login_abuse_pattern', {
      ipAddress:      row.ip_address,
      organizationId: row.organization_id,
      count:          parseInt(row.hit_count, 10),
      window:         '15m',
      threshold:      THRESHOLDS.LOGIN_HIT_COUNT,
      severity:       'HIGH',
      detail:         'Persistent login rate-limit hits from same IP — possible credential stuffing',
    });
  }

  return rows.length;
}

// ─── Signal 5: Refresh Burst Rate ────────────────────────────────────────────

/**
 * Detects abnormally high session creation rates per user+org within 10 minutes.
 * Each successful refresh rotation inserts a new session row (Phase 7 design).
 * A well-behaved Angular client with a 15-minute access token refreshes once
 * per window; 30+ new sessions in 10 minutes indicates a retry storm or attack.
 *
 * Index path: idx_sessions_user on user_id (range scan on created_at is sequential
 * for the short time window — acceptable for operational tables).
 *
 * Note: Adding CREATE INDEX ON sessions(created_at) would improve this query's
 * performance at scale. Not added here as Phase-8 requires no new migrations.
 */
async function detectRefreshBurst() {
  const { rows } = await pool.query(
    `SELECT user_id,
            organization_id,
            COUNT(*) AS session_count
     FROM   sessions
     WHERE  created_at >= NOW() - INTERVAL '10 minutes'
     GROUP BY user_id, organization_id
     HAVING COUNT(*) > $1`,
    [THRESHOLDS.REFRESH_COUNT],
  );

  for (const row of rows) {
    _emitSignal('refresh_burst_rate', {
      userId:         row.user_id,
      organizationId: row.organization_id,
      count:          parseInt(row.session_count, 10),
      window:         '10m',
      threshold:      THRESHOLDS.REFRESH_COUNT,
      severity:       'MEDIUM',
      detail:         'Abnormally high session creation rate — possible refresh retry storm or token misuse',
    });
  }

  return rows.length;
}

// ─── Signal 6: Organization Traffic Spike ────────────────────────────────────

/**
 * Detects a sudden volume spike in rate-limited events per organization by
 * comparing the current 15-minute window against the immediately prior 15 minutes.
 * A 5× increase filters normal business-hour variation while flagging anomalies.
 *
 * Single-pass query: conditional aggregation avoids two separate queries
 * and keeps the result consistent (no gap between two query executions).
 *
 * Index path: idx_rla_org (partial, WHERE organization_id IS NOT NULL) +
 *             idx_rla_created_at for the time range.
 */
async function detectOrgTrafficSpike() {
  const { rows } = await pool.query(
    `SELECT organization_id,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '15 minutes'
                     THEN 1 ELSE 0 END)  AS current_count,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 minutes'
                      AND created_at  < NOW() - INTERVAL '15 minutes'
                     THEN 1 ELSE 0 END)  AS baseline_count
     FROM   rate_limit_audit
     WHERE  organization_id IS NOT NULL
       AND  created_at     >= NOW() - INTERVAL '30 minutes'
     GROUP BY organization_id
     HAVING SUM(CASE WHEN created_at >= NOW() - INTERVAL '15 minutes'
                     THEN 1 ELSE 0 END)
            > $1 * GREATEST(
                SUM(CASE WHEN created_at >= NOW() - INTERVAL '30 minutes'
                           AND created_at  < NOW() - INTERVAL '15 minutes'
                         THEN 1 ELSE 0 END),
                1
              )`,
    [THRESHOLDS.ORG_SPIKE_RATIO],
  );

  for (const row of rows) {
    const current  = parseInt(row.current_count,  10);
    const baseline = parseInt(row.baseline_count, 10);
    const ratio    = baseline > 0
      ? (current / baseline).toFixed(1)
      : 'N/A (no baseline)';

    _emitSignal('org_traffic_spike', {
      organizationId: row.organization_id,
      currentCount:   current,
      baselineCount:  baseline,
      ratio:          Number(ratio) || ratio,
      window:         '15m vs prior 15m',
      threshold:      `${THRESHOLDS.ORG_SPIKE_RATIO}× baseline`,
      severity:       'MEDIUM',
      detail:         'Sudden rate-limit event spike for organization — possible scripted attack or volume anomaly',
    });
  }

  return rows.length;
}

// ─── Signal 7: Suspicious IP Spread ──────────────────────────────────────────

/**
 * Detects a user appearing from many distinct IP addresses within 10 minutes.
 * Each login and refresh rotation records the client IP in sessions.ip_address,
 * making sessions the natural source for short-window IP spread detection.
 *
 * More than 5 unique IPs in 10 minutes is a basic impossible-travel signal:
 * it indicates either session-sharing across geographic locations or a scripted
 * client cycling through proxies.
 *
 * Geo-lookup is intentionally excluded (best-effort, no external dependencies).
 *
 * Index path: idx_sessions_user on user_id; time range applied as filter.
 */
async function detectSuspiciousIpSpread() {
  const { rows } = await pool.query(
    `SELECT user_id,
            organization_id,
            COUNT(DISTINCT ip_address) AS unique_ip_count,
            ARRAY_AGG(DISTINCT ip_address) AS ip_list
     FROM   sessions
     WHERE  created_at >= NOW() - INTERVAL '10 minutes'
       AND  ip_address IS NOT NULL
     GROUP BY user_id, organization_id
     HAVING COUNT(DISTINCT ip_address) > $1`,
    [THRESHOLDS.IP_SPREAD_COUNT],
  );

  for (const row of rows) {
    _emitSignal('suspicious_ip_spread', {
      userId:         row.user_id,
      organizationId: row.organization_id,
      uniqueIpCount:  parseInt(row.unique_ip_count, 10),
      // Log IP list for operator forensics — no PII masking required for IPs.
      ipAddresses:    row.ip_list,
      window:         '10m',
      threshold:      THRESHOLDS.IP_SPREAD_COUNT,
      severity:       'HIGH',
      detail:         'User appearing from many IPs in short window — possible session hijacking or proxy rotation',
    });
  }

  return rows.length;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Runs all 7 security signals sequentially.
 * Each signal is isolated with its own try/catch — a failure in one
 * does not suppress the others.
 *
 * Returns a summary object for logging by the worker.
 * Never throws.
 *
 * @returns {Promise<{ signals: number, errors: number, durationMs: number }>}
 */
async function runAllSignals() {
  const startedAt = Date.now();
  let   signalsFired = 0;
  let   errors       = 0;

  const detectors = [
    ['refresh_reuse_spike',      detectRefreshReuseSpike],
    ['session_eviction_spike',   detectSessionEvictionSpike],
    ['permission_denied_burst',  detectPermissionDeniedBurst],
    ['login_abuse_pattern',      detectLoginAbuse],
    ['refresh_burst_rate',       detectRefreshBurst],
    ['org_traffic_spike',        detectOrgTrafficSpike],
    ['suspicious_ip_spread',     detectSuspiciousIpSpread],
  ];

  for (const [name, fn] of detectors) {
    try {
      const fired  = await fn();
      signalsFired += fired;
    } catch (err) {
      errors += 1;
      logger.warn('securityObservability: signal detector failed', {
        detector: name,
        error:    err.message,
      });
    }
  }

  return {
    signals:    signalsFired,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

module.exports = {
  runAllSignals,
  // Individual detectors exported for targeted testing.
  detectRefreshReuseSpike,
  detectSessionEvictionSpike,
  detectPermissionDeniedBurst,
  detectLoginAbuse,
  detectRefreshBurst,
  detectOrgTrafficSpike,
  detectSuspiciousIpSpread,
};
