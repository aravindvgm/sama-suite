#!/usr/bin/env tsx
'use strict';

/**
 * captureAttendanceExplain.ts
 *
 * Captures EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) evidence for the three
 * attendance queries that form the validation target.
 *
 * Queries captured (SQL is identical to attendance.service.js — not modified):
 *   1. Roster query       — getSectionRoster main SELECT
 *   2. Dashboard stats    — getAttendanceDashboard Query 1
 *   3. Repeat absentees   — getAttendanceDashboard Query 3
 *
 * Each query runs twice on a single fresh Client:
 *   COLD SESSION — new pg.Client + DISCARD ALL (clears plan cache, session state)
 *   WARM CACHE   — immediate re-run on the same open connection
 *
 * ── IMPORTANT — What "cold" and "warm" mean here ─────────────────────────────
 * "Cold session" clears PostgreSQL's local plan cache and session-level state
 * (DISCARD ALL).  It does NOT clear PostgreSQL shared_buffers (shared memory).
 * To measure true cold shared_buffer reads (buffer reads from disk rather than
 * RAM), restart the PostgreSQL server before running this script.
 *
 * The Buffers: shared read=N values in the output show how many 8 kB pages
 * were NOT in shared_buffers and had to be read from OS page cache or disk.
 * On a dev machine these reads are usually served from OS page cache (~0.1ms),
 * not from disk.  On a cold demo server this will be true disk I/O.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Prerequisites:
 *   Run core-backend/scripts/seedAttendanceValidation.ts first.
 *   The seeded org code must be SEED-VALIDATION-001.
 *
 * Output files (raw TEXT, no parsing):
 *   docs/security/phase9b-validation-results/roster_explain.txt
 *   docs/security/phase9b-validation-results/dashboard_explain.txt
 *   docs/security/phase9b-validation-results/repeat_absentees_explain.txt
 *
 * Usage:
 *   cd core-backend
 *   npx tsx scripts/captureAttendanceExplain.ts
 */

import * as fs     from 'fs';
import * as path   from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── Constants ─────────────────────────────────────────────────────────────────

const SEED_ORG_CODE = 'SEED-VALIDATION-001';

/**
 * Output directory relative to project root.
 * __dirname = core-backend/scripts/ → two levels up = project root.
 */
const OUTPUT_DIR = path.join(
  __dirname, '..', '..', 'docs', 'security', 'phase9b-validation-results',
);

const pool = require('../src/config/db');

// ── EXPLAIN ANALYZE wrappers ──────────────────────────────────────────────────
// These are exact copies of the queries in attendance.service.js.
// Parameters are passed via pg parameterized queries — no interpolation.

/**
 * Roster query — getSectionRoster main SELECT.
 * $1 = organizationId, $2 = sectionId, $3 = date
 */
const ROSTER_SQL = `
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
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

/**
 * Dashboard stats query — getAttendanceDashboard Query 1.
 * $1 = organizationId, $2 = date
 */
const DASHBOARD_STATS_SQL = `
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT
  COUNT(*)                                                AS marked_count,
  COUNT(*) FILTER (WHERE status IN ('PRESENT', 'LATE'))  AS present_count,
  COUNT(*) FILTER (WHERE status = 'ABSENT')              AS absent_count
FROM   attendance
WHERE  organization_id = $1
  AND  attendance_date = $2
  AND  deleted_at IS NULL
`.trim();

/**
 * Repeat absentees query — getAttendanceDashboard Query 3.
 * $1 = organizationId, $2 = date (used for both upper and lower bound via INTERVAL)
 */
const REPEAT_ABSENTEES_SQL = `
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
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

// ── Raw plan extraction ───────────────────────────────────────────────────────

/**
 * Execute an EXPLAIN ANALYZE query and return the raw TEXT plan.
 * FORMAT TEXT returns one row per plan line; we join them with newlines.
 */
async function explainRaw(
  sql:    string,
  values: unknown[],
): Promise<string> {
  const { rows } = await pool.query({ text: sql, values });
  // Each row has a single column named "QUERY PLAN"
  return rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
}

// ── Summary extraction (console only — files get raw text) ───────────────────

interface PlanSummary {
  planningMs:  string;
  executionMs: string;
  bufferLines: string[];
}

function extractSummary(raw: string): PlanSummary {
  const planMatch = raw.match(/Planning Time:\s+([\d.]+\s+ms)/);
  const execMatch = raw.match(/Execution Time:\s+([\d.]+\s+ms)/);

  // Collect every "Buffers: ..." line for display — these show per-node usage.
  const bufferLines = Array.from(raw.matchAll(/^\s*(Buffers:.*)/mg))
    .map(m => m[1].trim());

  return {
    planningMs:  planMatch?.[1]  ?? 'not found in output',
    executionMs: execMatch?.[1]  ?? 'not found in output',
    bufferLines: bufferLines.length ? bufferLines : ['(no buffer data — run with superuser for full BUFFERS output)'],
  };
}

// ── File writer ───────────────────────────────────────────────────────────────

function buildFileBlock(
  label:   string,
  orgId:   string,
  params:  Record<string, string>,
  rawPlan: string,
): string {
  const paramStr = Object.entries(params)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  return [
    `===== ${label} =====`,
    `Generated at   : ${new Date().toISOString()}`,
    `Organization   : ${orgId}`,
    `Parameters     :`,
    paramStr,
    `----------------------------------------------------------------------`,
    rawPlan,
    '',
  ].join('\n');
}

function writeFile(filename: string, content: string): void {
  const fullPath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`  → written: ${fullPath}`);
}

// ── Console reporter ──────────────────────────────────────────────────────────

function printSummary(
  label:   string,
  query:   string,
  summary: PlanSummary,
): void {
  console.log(`\n  ┌─ ${label} [${query}]`);
  console.log(`  │  Planning  : ${summary.planningMs}`);
  console.log(`  │  Execution : ${summary.executionMs}`);
  console.log(`  │  Buffers   :`);
  summary.bufferLines.forEach(line => console.log(`  │    ${line}`));
  console.log(`  └─────────────────────────────────`);
}

// ── Seed data resolver ────────────────────────────────────────────────────────

interface SeedData {
  orgId:     string;
  sectionId: string;
  date:      string;
}

async function resolveSeedData(): Promise<SeedData> {
  // Resolve organisation
  const { rows: orgRows } = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE code = $1 LIMIT 1`,
    [SEED_ORG_CODE],
  );
  if (orgRows.length === 0) {
    throw new Error(
      `Seeded organisation not found (code=${SEED_ORG_CODE}).\n` +
      `Run: npx tsx scripts/seedAttendanceValidation.ts`,
    );
  }
  const orgId = orgRows[0].id;

  // Pick the first active section in this org
  const { rows: secRows } = await pool.query<{ id: string }>(
    `SELECT id FROM sections
     WHERE  organization_id = $1
       AND  deleted_at IS NULL
     ORDER  BY created_at ASC
     LIMIT  1`,
    [orgId],
  );
  if (secRows.length === 0) {
    throw new Error('No sections found for seeded org. Re-run the seeder.');
  }
  const sectionId = secRows[0].id;

  // Use yesterday as the attendance date — seeder populates last 7 days.
  // Using yesterday avoids edge cases around midnight on the seeded date.
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = d.toISOString().split('T')[0];

  return { orgId, sectionId, date };
}

// ── Cold-session runner ───────────────────────────────────────────────────────

/**
 * Run an EXPLAIN query on a fresh connection.
 * DISCARD ALL clears prepared statements and session state.
 * Shared_buffers are NOT cleared — see file header note.
 */
async function runCold(
  sql:    string,
  values: unknown[],
): Promise<string> {
  await pool.query('DISCARD ALL');
  return await explainRaw(sql, values);
}

/**
 * Run an EXPLAIN query twice on the same connection.
 * First result = cold session plan (after DISCARD ALL).
 * Second result = warm cache re-run (plan and pages cached by first run).
 */
async function runColdThenWarm(
  sql:    string,
  values: unknown[],
): Promise<{ cold: string; warm: string }> {
  await pool.query('DISCARD ALL');
  const cold = await explainRaw(sql, values);
  const warm = await explainRaw(sql, values);
  return { cold, warm };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SAMA-SUITE Attendance — EXPLAIN ANALYZE Capture');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Output dir : ${OUTPUT_DIR}`);

  // ── Resolve seed data (read-only, tiny lookup) ─────────────────────────────

  process.stdout.write('\n[1/4] Resolving seeded data… ');
  let seed: SeedData;
  seed = await resolveSeedData();

  console.log('done.');
  console.log(`  org_id     : ${seed.orgId}`);
  console.log(`  section_id : ${seed.sectionId}`);
  console.log(`  date param : ${seed.date}`);

  // ── Roster query ───────────────────────────────────────────────────────────

  console.log('\n[2/4] Roster query (cold + warm)…');

  const rosterValues  = [seed.orgId, seed.sectionId, seed.date];
  const rosterResult  = await runColdThenWarm(ROSTER_SQL, rosterValues);
  const rosterParams  = { 'org_id': seed.orgId, 'section_id': seed.sectionId, 'date': seed.date };

  const rosterFile = [
    buildFileBlock('COLD SESSION (new connection + DISCARD ALL)', seed.orgId, rosterParams, rosterResult.cold),
    buildFileBlock('WARM CACHE (immediate re-run, same connection)', seed.orgId, rosterParams, rosterResult.warm),
  ].join('\n');

  writeFile('roster_explain.txt', rosterFile);
  printSummary('COLD', 'roster', extractSummary(rosterResult.cold));
  printSummary('WARM', 'roster', extractSummary(rosterResult.warm));

  // ── Dashboard stats query ──────────────────────────────────────────────────

  console.log('\n[3/4] Dashboard stats query (cold + warm)…');

  const dashValues  = [seed.orgId, seed.date];
  const dashParams  = { 'org_id': seed.orgId, 'date': seed.date };
  const dashResult  = await runColdThenWarm(DASHBOARD_STATS_SQL, dashValues);

  const dashFile = [
    buildFileBlock('COLD SESSION (new connection + DISCARD ALL)', seed.orgId, dashParams, dashResult.cold),
    buildFileBlock('WARM CACHE (immediate re-run, same connection)', seed.orgId, dashParams, dashResult.warm),
  ].join('\n');

  writeFile('dashboard_explain.txt', dashFile);
  printSummary('COLD', 'dashboard stats', extractSummary(dashResult.cold));
  printSummary('WARM', 'dashboard stats', extractSummary(dashResult.warm));

  // ── Repeat absentees query ─────────────────────────────────────────────────

  console.log('\n[4/4] Repeat absentees query (cold + warm)…');

  const absentValues  = [seed.orgId, seed.date];
  const absentParams  = { 'org_id': seed.orgId, 'date': seed.date };
  const absentResult  = await runColdThenWarm(REPEAT_ABSENTEES_SQL, absentValues);

  const absentFile = [
    buildFileBlock('COLD SESSION (new connection + DISCARD ALL)', seed.orgId, absentParams, absentResult.cold),
    buildFileBlock('WARM CACHE (immediate re-run, same connection)', seed.orgId, absentParams, absentResult.warm),
  ].join('\n');

  writeFile('repeat_absentees_explain.txt', absentFile);
  printSummary('COLD', 'repeat absentees', extractSummary(absentResult.cold));
  printSummary('WARM', 'repeat absentees', extractSummary(absentResult.warm));

  // ── Final summary ──────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  CAPTURE COMPLETE');
  console.log('  Files written to:');
  console.log(`  ${OUTPUT_DIR}`);
  console.log('');
  console.log('  NOTE: To capture true cold shared_buffer reads,');
  console.log('  restart PostgreSQL before running this script.');
  console.log('  The "shared read=N" values are only meaningful');
  console.log('  when shared_buffers have not been warmed by');
  console.log('  previous queries on this data.');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch((err: Error) => {
  console.error('\n✗ Capture failed:', err.message);
  process.exit(1);
});
