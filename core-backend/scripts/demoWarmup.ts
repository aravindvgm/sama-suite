#!/usr/bin/env tsx
'use strict';

/**
 * demoWarmup.ts
 *
 * Warms PostgreSQL shared_buffers, the Node process, AND the HTTP API layer
 * before a live demo.
 *
 * Phase 1 — SQL warmup (unchanged):
 *   Roster query          × 5  (section-level, heaviest JOIN)
 *   Dashboard stats query × 3  (org-level aggregate)
 *   Repeat absentees      × 3  (7-day window GROUP BY)
 *
 * Phase 2 — HTTP warmup:
 *   GET /api/:orgId/classes
 *   GET /api/:orgId/classes/:classId/sections
 *   GET /api/:orgId/attendance/section/:sectionId?date=
 *   GET /api/:orgId/attendance/dashboard?date=
 *
 *   A short-lived JWT is minted internally from JWT_SECRET (already in .env).
 *   No token setup required from the caller.
 *
 * No EXPLAIN. No file writes. No deletes. Read-only.
 *
 * Prerequisites:
 *   npx tsx scripts/seedAttendanceValidation.ts
 *   Backend running (default http://localhost:3000, override via API_BASE_URL)
 *
 * Usage:
 *   cd core-backend
 *   npx tsx scripts/demoWarmup.ts
 */

import { Pool }        from 'pg';
import { performance } from 'perf_hooks';
import * as crypto     from 'crypto';
import * as path       from 'path';
import * as dotenv     from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── Constants ──────────────────────────────────────────────────────────────────

const SEED_ORG_CODE  = 'SEED-VALIDATION-001';
const ROSTER_RUNS    = 5;
const DASHBOARD_RUNS = 3;
const ABSENTEES_RUNS = 3;
const API_BASE_URL   = process.env.API_BASE_URL || 'http://localhost:3000';

// ── Pool ───────────────────────────────────────────────────────────────────────

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'sama_suite',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max:      5,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// ── Queries — identical SQL to attendance.service.js (no EXPLAIN) ─────────────

/** $1 = organizationId  $2 = sectionId  $3 = date */
const ROSTER_SQL = `
SELECT
  se.student_id,
  se.id           AS enrollment_id,
  s.first_name,
  s.last_name,
  a.status
FROM   student_enrollments se
JOIN   students             s  ON s.id  = se.student_id
                               AND s.deleted_at IS NULL
LEFT   JOIN attendance      a  ON a.student_id      = se.student_id
                               AND a.organization_id = $1
                               AND a.attendance_date = $3
                               AND a.deleted_at IS NULL
WHERE  se.organization_id = $1
  AND  se.section_id      = $2
  AND  se.deleted_at IS NULL
ORDER  BY s.last_name ASC, s.first_name ASC
`.trim();

/** $1 = organizationId  $2 = date */
const DASHBOARD_STATS_SQL = `
SELECT
  COUNT(*)                                                AS marked_count,
  COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE'))  AS present_count,
  COUNT(*) FILTER (WHERE status = 'ABSENT')              AS absent_count
FROM   attendance
WHERE  organization_id = $1
  AND  attendance_date = $2
  AND  deleted_at IS NULL
`.trim();

/** $1 = organizationId  $2 = date */
const REPEAT_ABSENTEES_SQL = `
SELECT
  s.id         AS student_id,
  s.first_name,
  s.last_name,
  COUNT(*)     AS absent_days
FROM   attendance  a
JOIN   students    s ON s.id = a.student_id AND s.deleted_at IS NULL
WHERE  a.organization_id = $1
  AND  a.attendance_date >= $2::date - INTERVAL '6 days'
  AND  a.attendance_date <= $2::date
  AND  a.status           = 'ABSENT'
  AND  a.deleted_at IS NULL
GROUP  BY s.id, s.first_name, s.last_name
HAVING COUNT(*) >= 3
ORDER  BY absent_days DESC, s.last_name ASC
`.trim();

// ── Seed data resolver ─────────────────────────────────────────────────────────

interface SeedData {
  orgId:     string;
  classId:   string;
  sectionId: string;
  date:      string;
  userId:    string;
  userRole:  string;
}

async function resolveSeedData(): Promise<SeedData> {
  const { rows: orgRows } = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE code = $1 LIMIT 1`,
    [SEED_ORG_CODE],
  );
  if (orgRows.length === 0) {
    throw new Error(
      `Scale dataset not found (code=${SEED_ORG_CODE}).\n` +
      `Run: npx tsx scripts/seedAttendanceValidation.ts`,
    );
  }
  const orgId = orgRows[0].id;

  // Fetch the first section AND its parent class in one query.
  const { rows: secRows } = await pool.query<{ id: string; class_id: string }>(
    `SELECT id, class_id FROM sections
     WHERE  organization_id = $1
       AND  deleted_at IS NULL
     ORDER  BY created_at ASC
     LIMIT  1`,
    [orgId],
  );
  if (secRows.length === 0) {
    throw new Error('No sections found for scale org. Re-run the seeder.');
  }
  const sectionId = secRows[0].id;
  const classId   = secRows[0].class_id;

  // Resolve an active member to use as the warmup JWT subject.
  const { rows: memberRows } = await pool.query<{ user_id: string; role: string }>(
    `SELECT m.user_id, r.key AS role
     FROM   memberships m
     JOIN   roles       r ON r.id = m.role_id
     WHERE  m.organization_id = $1
       AND  m.status = 'active'
     LIMIT  1`,
    [orgId],
  );
  let userId:   string;
  let userRole: string;
  if (memberRows.length === 0) {
    console.warn('\n⚠ WARMUP MODE: fallback demo identity');
    console.warn('  Warmup fallback identity used (no memberships found).');
    userId   = 'demo-warmup-user';
    userRole = 'ADMIN';
  } else {
    userId   = memberRows[0].user_id;
    userRole = memberRows[0].role;
  }

  // Yesterday — seeder populates last 7 days.
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = d.toISOString().split('T')[0];

  return { orgId, classId, sectionId, date, userId, userRole };
}

// ── Warmup runner (SQL) ────────────────────────────────────────────────────────

async function runN(
  label:  string,
  sql:    string,
  params: unknown[],
  n:      number,
): Promise<void> {
  process.stdout.write(`  ${label.padEnd(24)} `);
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await pool.query(sql, params);
    const ms = Math.round(performance.now() - t0);
    process.stdout.write(`[run ${i + 1}: ${ms} ms]  `);
  }
  process.stdout.write('\n');
}

// ── HTTP warmup ────────────────────────────────────────────────────────────────

/**
 * Mint a short-lived HS256 JWT using JWT_SECRET from .env.
 * Uses only Node's built-in `crypto` — no extra dependencies.
 * Token expires in 5 minutes (enough to complete the warmup sequence).
 */
function mintWarmupToken(userId: string, orgId: string, role: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set in .env — cannot mint warmup token');

  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub:            userId,
    organizationId: orgId,
    role,
    iat:            now,
    exp:            now + 300, // 5 min
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${sig}`;
}

interface HttpResult {
  ms:       number;
  nonFatal: boolean; // true when 401/403 was received and execution continued
  status:   number;
}

/**
 * Execute a single authenticated GET and return a result object.
 *
 * 401 / 403  — non-fatal: returns { nonFatal: true } so the caller can print
 *              the appropriate warning. Execution continues.
 * 5xx        — fatal: throws so true server errors are never silently swallowed.
 * 12s timeout — AbortController cancels the fetch; throws a hard abort error.
 *              Catches firewall blocks and unresponsive backends before they
 *              stall the warmup indefinitely.
 */
async function httpGet(label: string, url: string, token: string): Promise<HttpResult> {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 12_000);

  const t0 = performance.now();
  let res: Response;

  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal:  controller.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      console.warn('HTTP warmup timeout exceeded.');
      throw new Error('WARMUP ABORT: backend unreachable or firewall blocked.');
    }
    throw err; // network-level errors (ECONNREFUSED, etc.) propagate as-is
  }

  clearTimeout(timeoutId);
  const ms = Math.round(performance.now() - t0);

  if (res.status === 401 || res.status === 403) {
    return { ms, nonFatal: true, status: res.status };
  }

  if (!res.ok) {
    throw new Error(
      `Warmup HTTP endpoint failed: ${label} (${res.status} ${res.statusText})`,
    );
  }

  return { ms, nonFatal: false, status: res.status };
}

/** Run the four HTTP warmup endpoints in order and print per-request timings. */
async function runHttpWarmup(seed: SeedData): Promise<void> {
  // ── TLS / DNS warmup ──────────────────────────────────────────────────────
  // A single HEAD to the API root primes the DNS resolver cache and completes
  // the TLS handshake before any timed endpoint requests are issued.
  // Response body is never read (HEAD has none); status is intentionally ignored.
  console.log('Warming TLS/DNS...');
  const tlsController = new AbortController();
  const tlsTimeoutId  = setTimeout(() => tlsController.abort(), 12_000);
  try {
    await fetch(API_BASE_URL, {
      method: 'HEAD',
      signal: tlsController.signal,
    });
  } catch (err: unknown) {
    clearTimeout(tlsTimeoutId);
    if ((err as { name?: string }).name === 'AbortError') {
      console.warn('HTTP warmup timeout exceeded.');
      throw new Error('WARMUP ABORT: backend unreachable or firewall blocked.');
    }
    throw err;
  }
  clearTimeout(tlsTimeoutId);

  const token = mintWarmupToken(seed.userId, seed.orgId, seed.userRole);
  const base  = `${API_BASE_URL}/api/${seed.orgId}`;

  const endpoints: [string, string][] = [
    ['classes',   `${base}/classes`],
    ['sections',  `${base}/classes/${seed.classId}/sections`],
    ['roster',    `${base}/attendance/section/${seed.sectionId}?date=${seed.date}`],
    ['dashboard', `${base}/attendance/dashboard?date=${seed.date}`],
  ];

  console.log('\nHTTP Warmup:');
  let authRejections = 0;
  for (const [label, url] of endpoints) {
    const { ms, nonFatal, status } = await httpGet(label, url, token);
    if (nonFatal) {
      authRejections++;
      console.log(`  ${label.padEnd(18)}[${ms} ms] (${status} non-fatal)`);
      console.warn(`  ⚠ WARMUP HTTP non-fatal auth rejection: ${label}`);
    } else {
      console.log(`  ${label.padEnd(18)}[${ms} ms]`);
    }
  }
  if (authRejections > 0) {
    console.warn(`\n⚠ Warmup completed with ${authRejections} non-fatal auth rejection${authRejections === 1 ? '' : 's'}.`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SAMA-SUITE Demo Warmup');
  console.log('══════════════════════════════════════════════════════════════');

  process.stdout.write('\nResolving seed data… ');
  const seed = await resolveSeedData();
  console.log('done.');
  console.log(`  org_id     : ${seed.orgId}`);
  console.log(`  section_id : ${seed.sectionId}`);
  console.log(`  date       : ${seed.date}`);
  console.log('');

  // ── Phase 1: SQL warmup ──────────────────────────────────────────────────────

  const sqlStart = performance.now();

  await runN(
    `Roster ×${ROSTER_RUNS}`,
    ROSTER_SQL,
    [seed.orgId, seed.sectionId, seed.date],
    ROSTER_RUNS,
  );

  await runN(
    `Dashboard ×${DASHBOARD_RUNS}`,
    DASHBOARD_STATS_SQL,
    [seed.orgId, seed.date],
    DASHBOARD_RUNS,
  );

  await runN(
    `Repeat absentees ×${ABSENTEES_RUNS}`,
    REPEAT_ABSENTEES_SQL,
    [seed.orgId, seed.date],
    ABSENTEES_RUNS,
  );

  const sqlMs = Math.round(performance.now() - sqlStart);
  console.log('');
  console.log(`SQL warmup duration   : ${sqlMs} ms`);
  console.log('Buffers warm.');

  // ── Phase 2: HTTP warmup ─────────────────────────────────────────────────────

  await runHttpWarmup(seed);

  console.log('');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  API layer warm. Demo ready.');
  console.log('══════════════════════════════════════════════════════════════');
}

main()
  .catch((err: Error) => {
    console.error('\n✗ Demo warmup failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
