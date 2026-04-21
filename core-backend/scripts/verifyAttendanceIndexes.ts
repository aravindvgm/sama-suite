#!/usr/bin/env tsx
'use strict';

/**
 * verifyAttendanceIndexes.ts
 *
 * Read-only verification of 4 attendance-related partial indexes created by
 * migration 031_classes_enrollments_attendance.sql.
 *
 * For each index this script prints:
 *   EXISTS    : YES / NO
 *   TABLE     : table the index lives on
 *   DEFINITION: full CREATE INDEX DDL from pg_get_indexdef()
 *   PREDICATE : predicate expression (if partial), or "(none)"
 *
 * This script NEVER creates or alters anything.  Read-only queries only.
 *
 * Prerequisites:
 *   Run core-backend/scripts/seedAttendanceValidation.ts first, OR ensure
 *   migration 031 has been applied so the tables exist.
 *
 * Usage:
 *   cd core-backend
 *   npx tsx scripts/verifyAttendanceIndexes.ts
 */

import * as path   from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── Target indexes ─────────────────────────────────────────────────────────────

const INDEXES = [
  'idx_se_org_section_active',
  'idx_att_org_student_date',
  'idx_att_org_date',
  'idx_att_org_date_absent',
] as const;

const pool = require('../src/config/db');

// ── Query ──────────────────────────────────────────────────────────────────────

/**
 * Returns one row per index name found, with:
 *   indexname  — canonical name from pg_indexes
 *   tablename  — table the index is on
 *   definition — full CREATE INDEX DDL (pg_get_indexdef includes CONCURRENTLY,
 *                column list, opclasses, and WHERE predicate if partial)
 *   predicate  — human-readable WHERE expression from pg_get_expr, or NULL
 *                for a non-partial (full) index
 */
const VERIFY_SQL = `
SELECT
  pi.indexname,
  pi.tablename,
  pg_get_indexdef(pc.oid)                              AS definition,
  pg_get_expr(pgi.indpred, pgi.indrelid, true)         AS predicate
FROM   pg_indexes  pi
JOIN   pg_class    pc  ON pc.relname = pi.indexname
JOIN   pg_index    pgi ON pgi.indexrelid = pc.oid
WHERE  pi.indexname = $1
`.trim();

interface IndexRow {
  indexname:  string;
  tablename:  string;
  definition: string;
  predicate:  string | null;
}

// ── Printer ────────────────────────────────────────────────────────────────────

/**
 * Wrap a long string at maxWidth characters, indenting continuation lines
 * with the given prefix.
 */
function wrapLine(text: string, prefix: string, maxWidth = 72): string {
  if (text.length <= maxWidth) return `${prefix}${text}`;
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > maxWidth) {
    // Try to break on a space within the allowed width
    let cut = remaining.lastIndexOf(' ', maxWidth);
    if (cut <= 0) cut = maxWidth; // No space found — hard wrap
    lines.push(`${prefix}${remaining.slice(0, cut).trimEnd()}`);
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length) lines.push(`${prefix}${remaining}`);
  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('══════════════════════════════════════════════════════════════');
  console.log('  SAMA-SUITE Attendance — Index Verification (read-only)');
  console.log('══════════════════════════════════════════════════════════════\n');

  let allPresent = true;

  try {
    for (const indexName of INDEXES) {
      const { rows } = await pool.query(VERIFY_SQL, [indexName]);

      console.log(`┌─ ${indexName}`);

      if (rows.length === 0) {
        allPresent = false;
        console.log('│  EXISTS     : NO');
        console.log('│  ⚠  Not found in pg_indexes / pg_class.');
        console.log('│     Ensure migration 031 has been applied and the');
        console.log('│     CREATE INDEX CONCURRENTLY statement completed.');
      } else {
        const row = rows[0];
        console.log('│  EXISTS     : YES');
        console.log(`│  TABLE      : ${row.tablename}`);
        console.log('│  DEFINITION :');
        console.log(wrapLine(row.definition, '│    '));
        if (row.predicate !== null) {
          console.log(`│  PREDICATE  : ${row.predicate}`);
        } else {
          console.log('│  PREDICATE  : (none — full index, not partial)');
        }
      }

      console.log(`└${'─'.repeat(60)}\n`);
    }
  } finally {}

  console.log('══════════════════════════════════════════════════════════════');
  if (allPresent) {
    console.log('  RESULT : ALL 4 INDEXES PRESENT');
  } else {
    console.log('  RESULT : ONE OR MORE INDEXES MISSING');
    console.log('  ACTION : Apply migration 031 and run the CONCURRENTLY');
    console.log('           CREATE INDEX statements on the target database.');
  }
  console.log('══════════════════════════════════════════════════════════════\n');

  if (!allPresent) {
    process.exit(1);
  }
}

main().catch((err: Error) => {
  console.error('\n✗ Verification failed:', err.message);
  process.exit(1);
});
