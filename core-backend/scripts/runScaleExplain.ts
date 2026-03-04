#!/usr/bin/env tsx
'use strict';

/**
 * runScaleExplain.ts
 *
 * Executes EXPLAIN (ANALYZE, BUFFERS) for the three attendance queries
 * against the 10,000-student scale dataset and writes raw planner output
 * to docs/security/phase9b-validation-results/scale-test.txt.
 *
 * Output file contains raw EXPLAIN text only — no analysis, no thresholds.
 * Captures per-block:
 *   • Plan node types  (Nested Loop / Hash Join / Merge Join / Index Scan …)
 *   • Planned rows vs actual rows
 *   • Buffers: shared hit=N read=N
 *   • Planning Time and Execution Time
 *
 * Each query runs twice on a single fresh connection:
 *   cold — new pg.Client + DISCARD ALL (clears plan cache, session state)
 *   warm — immediate re-run on the same open connection
 *
 * Prerequisites:
 *   npx tsx scripts/seedAttendanceValidation.ts   (must complete first)
 *
 * Usage:
 *   cd core-backend
 *   npx tsx scripts/runScaleExplain.ts
 */

import { Client }  from 'pg';
import * as fs     from 'fs';
import * as path   from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── Constants ─────────────────────────────────────────────────────────────────

const SEED_ORG_CODE = 'SEED-VALIDATION-001';

const OUTPUT_FILE = path.join(
  __dirname, '..', '..', 'docs', 'security', 'phase9b-validation-results', 'scale-test.txt',
);

// ── Regression thresholds (cold execution time, ms) ──────────────────────────
// Applied to cold runs only — warm cache hits are not representative of prod.

const THRESHOLD_ROSTER_MS    = 500;
const THRESHOLD_DASHBOARD_MS = 300;
const THRESHOLD_ABSENTEES_MS = 400;

// ── DB client factory ─────────────────────────────────────────────────────────

function makeClient(): Client {
  return new Client({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME     || 'sama_suite',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

// ── EXPLAIN queries — identical SQL to attendance.service.js ──────────────────

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

// ── Raw plan capture ──────────────────────────────────────────────────────────

async function explainRaw(
  client: Client,
  sql:    string,
  values: unknown[],
): Promise<string> {
  const { rows } = await client.query({ text: sql, values });
  return rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
}

// ── Cold + warm runner ────────────────────────────────────────────────────────

async function runColdThenWarm(
  sql:    string,
  values: unknown[],
): Promise<{ cold: string; warm: string }> {
  const client = makeClient();
  await client.connect();
  try {
    await client.query('DISCARD ALL');
    const cold = await explainRaw(client, sql, values);
    const warm = await explainRaw(client, sql, values);
    return { cold, warm };
  } finally {
    await client.end();
  }
}

// ── Seed data resolver ────────────────────────────────────────────────────────

interface SeedData {
  orgId:       string;
  sectionId:   string;
  date:        string;
  studentCount: number;
}

async function resolveSeedData(client: Client): Promise<SeedData> {
  const { rows: orgRows } = await client.query<{ id: string }>(
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

  const { rows: secRows } = await client.query<{ id: string }>(
    `SELECT id FROM sections
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

  const { rows: countRows } = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM students WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId],
  );
  const studentCount = Number(countRows[0].n);

  // Use yesterday — seeder populates last 7 days.
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = d.toISOString().split('T')[0];

  return { orgId, sectionId, date, studentCount };
}

// ── File block builder ────────────────────────────────────────────────────────

function block(label: string, plan: string): string {
  return `─── ${label} ${'─'.repeat(Math.max(0, 72 - label.length - 5))}\n${plan}\n`;
}

// ── Execution time parser ─────────────────────────────────────────────────────

/**
 * Extracts the numeric execution time from a raw EXPLAIN ANALYZE plan string.
 * PostgreSQL always emits "Execution Time: N.NNN ms" as the final line.
 * Returns NaN if the line is absent (e.g. plan capture failed).
 */
function parseExecutionMs(plan: string): number {
  const m = plan.match(/Execution Time:\s+([\d.]+)\s+ms/);
  return m ? parseFloat(m[1]) : NaN;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });

  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SAMA-SUITE Attendance — Scale EXPLAIN Capture  [10k]');
  console.log('══════════════════════════════════════════════════════════════');

  // ── Resolve seed data ───────────────────────────────────────────────────────

  process.stdout.write('\n[1/4] Resolving scale dataset… ');
  const resolveClient = makeClient();
  await resolveClient.connect();
  let seed: SeedData;
  try {
    seed = await resolveSeedData(resolveClient);
  } finally {
    await resolveClient.end();
  }
  console.log('done.');
  console.log(`  students   : ${seed.studentCount}`);
  console.log(`  org_id     : ${seed.orgId}`);
  console.log(`  section_id : ${seed.sectionId}`);
  console.log(`  date param : ${seed.date}`);

  const fileLines: string[] = [
    `Generated     : ${new Date().toISOString()}`,
    `Scale dataset : ${seed.studentCount} students | org_id: ${seed.orgId} | date: ${seed.date}`,
    ``,
  ];

  // ── Roster query ────────────────────────────────────────────────────────────

  process.stdout.write('\n[2/4] Roster query (cold + warm)… ');
  const roster = await runColdThenWarm(ROSTER_SQL, [seed.orgId, seed.sectionId, seed.date]);
  console.log('done.');
  fileLines.push(block('ROSTER QUERY — cold', roster.cold));
  fileLines.push(block('ROSTER QUERY — warm', roster.warm));

  // ── Dashboard stats query ───────────────────────────────────────────────────

  process.stdout.write('\n[3/4] Dashboard stats query (cold + warm)… ');
  const dashboard = await runColdThenWarm(DASHBOARD_STATS_SQL, [seed.orgId, seed.date]);
  console.log('done.');
  fileLines.push(block('DASHBOARD STATS — cold', dashboard.cold));
  fileLines.push(block('DASHBOARD STATS — warm', dashboard.warm));

  // ── Repeat absentees query ──────────────────────────────────────────────────

  process.stdout.write('\n[4/4] Repeat absentees query (cold + warm)… ');
  const absent = await runColdThenWarm(REPEAT_ABSENTEES_SQL, [seed.orgId, seed.date]);
  console.log('done.');
  fileLines.push(block('REPEAT ABSENTEES — cold', absent.cold));
  fileLines.push(block('REPEAT ABSENTEES — warm', absent.warm));

  // ── Write output (always — even if thresholds fail below) ───────────────────

  fs.writeFileSync(OUTPUT_FILE, fileLines.join('\n'), 'utf8');

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  Written: ${OUTPUT_FILE}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  // ── Regression threshold checks (cold runs only) ─────────────────────────────
  // Checked after file write so raw evidence is always persisted on failure.

  let failed = false;

  const rosterMs    = parseExecutionMs(roster.cold);
  const dashboardMs = parseExecutionMs(dashboard.cold);
  const absenteesMs = parseExecutionMs(absent.cold);

  console.log('  Threshold check (cold execution time):');
  console.log(`    Roster       : ${rosterMs} ms    (limit ${THRESHOLD_ROSTER_MS} ms)`);
  console.log(`    Dashboard    : ${dashboardMs} ms    (limit ${THRESHOLD_DASHBOARD_MS} ms)`);
  console.log(`    Absentees    : ${absenteesMs} ms    (limit ${THRESHOLD_ABSENTEES_MS} ms)`);

  if (isNaN(rosterMs) || rosterMs > THRESHOLD_ROSTER_MS) {
    console.error(`FAIL: Roster exceeded threshold (${rosterMs} ms > ${THRESHOLD_ROSTER_MS} ms)`);
    failed = true;
  }
  if (isNaN(dashboardMs) || dashboardMs > THRESHOLD_DASHBOARD_MS) {
    console.error(`FAIL: Dashboard exceeded threshold (${dashboardMs} ms > ${THRESHOLD_DASHBOARD_MS} ms)`);
    failed = true;
  }
  if (isNaN(absenteesMs) || absenteesMs > THRESHOLD_ABSENTEES_MS) {
    console.error(`FAIL: Repeat absentees exceeded threshold (${absenteesMs} ms > ${THRESHOLD_ABSENTEES_MS} ms)`);
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error('\n✗ Scale explain failed:', err.message);
  process.exit(1);
});
