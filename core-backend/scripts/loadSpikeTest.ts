#!/usr/bin/env tsx
'use strict';

/**
 * loadSpikeTest.ts
 *
 * Fires CONCURRENCY concurrent roster SELECT queries against the scale
 * validation dataset to simulate a simultaneous load spike.
 *
 * Measures:
 *   TOTAL_MS — wall-clock time from first request launched to last completed
 *   AVG_MS   — arithmetic mean of individual query round-trip durations
 *   MAX_MS   — slowest individual query (worst-case user experience)
 *
 * Each per-request timer starts when the request enters the pool queue,
 * so TOTAL_MS and AVG_MS include connection acquisition time.
 *
 * Read-only. No data writes. No schema changes.
 * SQL is identical to attendance.service.js getSectionRoster — no EXPLAIN wrapper.
 *
 * Prerequisites:
 *   npx tsx scripts/seedAttendanceValidation.ts
 *
 * Usage:
 *   cd core-backend
 *   npx tsx scripts/loadSpikeTest.ts
 */

import { performance }   from 'perf_hooks';
import * as path         from 'path';
import * as dotenv       from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── Constants ──────────────────────────────────────────────────────────────────

const SEED_ORG_CODE = 'SEED-VALIDATION-001';
const CONCURRENCY   = 50;

const pool = require('../src/config/db');

// ── Roster SQL — identical to attendance.service.js getSectionRoster ──────────
// $1 = organizationId  $2 = sectionId  $3 = date

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

// ── Seed data resolver ─────────────────────────────────────────────────────────

interface SeedData {
  orgId:     string;
  sectionId: string;
  date:      string;
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

  const { rows: secRows } = await pool.query<{ id: string }>(
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

  // Yesterday — seeder populates last 7 days.
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const date = d.toISOString().split('T')[0];

  return { orgId, sectionId, date };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  SAMA-SUITE Roster — Load Spike Test  [${CONCURRENCY} concurrent]`);
  console.log('══════════════════════════════════════════════════════════════');

  process.stdout.write('\nResolving seed data… ');
  const seed = await resolveSeedData();
  console.log('done.');
  console.log(`  org_id     : ${seed.orgId}`);
  console.log(`  section_id : ${seed.sectionId}`);
  console.log(`  date       : ${seed.date}`);
  console.log(`\nFiring ${CONCURRENCY} concurrent roster queries…`);

  const params = [seed.orgId, seed.sectionId, seed.date];

  // Set wall-clock start before spawning requests so TOTAL_MS includes the
  // full launch-to-last-completion window.
  const wallStart = performance.now();

  // Each IIFE captures its own t0 at the moment it enters the pool queue.
  // Promise.all keeps all 50 in-flight simultaneously.
  const durations = await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      (async (): Promise<number> => {
        const t0 = performance.now();
        await pool.query(ROSTER_SQL, params);
        return performance.now() - t0;
      })(),
    ),
  );

  const wallMs  = performance.now() - wallStart;
  const totalMs = Math.round(wallMs);
  const avgMs   = Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length);
  const maxMs   = Math.round(Math.max(...durations));

  console.log('');
  console.log(`TOTAL_MS : ${totalMs}`);
  console.log(`AVG_MS   : ${avgMs}`);
  console.log(`MAX_MS   : ${maxMs}`);
  console.log('');
}

main()
  .catch((err: Error) => {
    console.error('\n✗ Load spike test failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
