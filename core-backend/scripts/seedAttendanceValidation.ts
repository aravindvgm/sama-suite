#!/usr/bin/env tsx
'use strict';

/**
 * seedAttendanceValidation.ts
 *
 * Performance validation dataset generator for SAMA-SUITE Attendance module.
 *
 * Dataset produced:
 *   1   organisation  (code: SEED-VALIDATION-001)
 *   25  classes  × 10 sections          =  250 sections
 *   40  students × 250 sections          = 10,000 students
 *   10,000 student_enrollments
 *   10,000 students × 7 days             = 70,000 attendance rows
 *   Distribution: 80% PRESENT · 15% ABSENT · 5% LATE
 *
 * Safety contract:
 *   • Deletes ONLY rows belonging to SEED-VALIDATION-001 organisation.
 *   • Never truncates or modifies global tables (users, permissions, roles).
 *   • Deletion order respects foreign-key dependency graph.
 *
 * Usage (no compilation needed):
 *   cd core-backend
 *   npx tsx scripts/seedAttendanceValidation.ts
 *
 * Run this from inside core-backend/ so .env is resolved correctly.
 */

import type { PoolClient } from 'pg';
import { v4 as uuidv4 }    from 'uuid';
import * as dotenv          from 'dotenv';
import * as path            from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ── Tuneable constants ────────────────────────────────────────────────────────

const SEED_ORG_CODE          = 'SEED-VALIDATION-001';
const SEED_ORG_NAME          = 'Validation Test School';
const ACADEMIC_YEAR          = '2024-2025';

const NUM_CLASSES            = 25;
const SECTIONS_PER_CLASS     = 10;
const STUDENTS_PER_SECTION   = 40;
const ATTENDANCE_DAYS        = 7;

/** Batch size for attendance INSERT — keeps per-round-trip payload bounded. */
const ATT_BATCH_SIZE         = 1000;
/** Batch size for student INSERT. */
const STU_BATCH_SIZE         = 500;
/** Batch size for enrollment INSERT. */
const ENR_BATCH_SIZE         = 500;

// ── Status distribution (must sum to 100) ─────────────────────────────────────

interface StatusWeight { status: string; weight: number; }

const STATUS_WEIGHTS: StatusWeight[] = [
  { status: 'PRESENT', weight: 80 },
  { status: 'ABSENT',  weight: 15 },
  { status: 'LATE',    weight: 5  },
];

// ── Name pools (Indian school context) ───────────────────────────────────────
// 100 first × 100 last = 10,000 unique combinations — no repeats for 10,000 students.

const FIRST_NAMES: string[] = [
  // original 60
  'Arjun','Priya','Rahul','Ananya','Vikram','Sneha','Rohan','Kavya',
  'Aditya','Meera','Karan','Ishita','Dhruv','Pooja','Siddharth','Riya',
  'Amit','Nisha','Raj','Divya','Aarav','Sana','Harsh','Tanvi',
  'Nikhil','Swati','Varun','Preeti','Yash','Simran','Akash','Neha',
  'Manish','Shruti','Deepak','Anjali','Suresh','Pallavi','Kunal','Megha',
  'Vishal','Rekha','Alok','Sunita','Pradeep','Bindu','Rajesh','Sujata',
  'Naresh','Leela','Aryan','Kritika','Vivek','Namrata','Sachin','Gauri',
  'Saurabh','Madhuri','Nitin','Archana',
  // extended to 100
  'Anand','Anil','Asha','Bhavna','Chetan','Disha','Farhan','Gaurav',
  'Geeta','Girish','Hemant','Jagdish','Jayesh','Jyoti','Kavita','Kedar',
  'Kishore','Lata','Mahesh','Mala','Mohan','Nalini','Naveen','Neeraj',
  'Nilesh','Pankaj','Poonam','Priyanka','Rakesh','Ramesh','Rohit','Samir',
  'Sangeeta','Santosh','Seema','Shankar','Sheetal','Sunil','Vaibhav','Vandana',
];

const LAST_NAMES: string[] = [
  // original 35
  'Sharma','Patel','Gupta','Singh','Kumar','Verma','Mishra','Joshi',
  'Agarwal','Rao','Nair','Reddy','Shah','Mehta','Iyer','Pillai',
  'Chatterjee','Banerjee','Das','Roy','Bose','Ghosh','Kapoor','Malhotra',
  'Chopra','Khanna','Saxena','Shukla','Tripathi','Pandey','Dubey','Tiwari',
  'Yadav','Srivastava','Choudhary',
  // extended to 100
  'Acharya','Ahuja','Arora','Awasthi','Bajaj','Bhat','Bhatt','Bhattacharya',
  'Chauhan','Chavan','Dalvi','Desai','Deshpande','Dey','Dixit','Gaikwad',
  'Gokhale','Goyal','Hegde','Jain','Jaiswal','Jha','Kamath','Kaur',
  'Kelkar','Khare','Kohli','Kulkarni','Mahajan','Marathe','Modi','Mukherjee',
  'Murthy','Naik','Narayanan','Nigam','Pai','Parekh','Parikh','Patil',
  'Pawar','Pradhan','Raghavan','Ranade','Rathod','Sathe','Sawant','Sengupta',
  'Sethi','Shetty','Thakur','Tilak','Wagh','Bakshi','Bali','Diwan',
  'Hora','Jog','Joglekar','Karnik','Limaye','Ogale','Tendulkar','Vyas',
  'Amin',
];

// 100 × 100 = 10,000 unique combinations — covers all 10,000 students.
function nameAt(index: number): { firstName: string; lastName: string } {
  return {
    firstName: FIRST_NAMES[index % FIRST_NAMES.length],
    lastName:  LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length],
  };
}

// Generated at runtime — 25 entries.
const CLASS_NAMES: string[]   = Array.from({ length: NUM_CLASSES }, (_, i) => `Grade ${i + 1}`);
const SECTION_NAMES: string[] = ['A','B','C','D','E','F','G','H','I','J'];

const pool = require('../src/config/db');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Weighted random status from STATUS_WEIGHTS. */
function randomStatus(): string {
  const r = Math.random() * 100;
  let cumulative = 0;
  for (const { status, weight } of STATUS_WEIGHTS) {
    cumulative += weight;
    if (r < cumulative) return status;
  }
  return 'PRESENT';
}

/** Returns last N calendar dates as ISO strings, newest first. */
function pastDates(days: number): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toISOString().split('T')[0];
  });
}

// ── Batch INSERT helpers (UNNEST pattern — 1 round-trip per batch) ─────────────

interface StudentRow {
  id:        string;
  firstName: string;
  lastName:  string;
}

async function insertStudentBatch(
  client:  PoolClient,
  orgId:   string,
  batch:   StudentRow[],
): Promise<void> {
  await client.query(
    `INSERT INTO students (id, organization_id, first_name, last_name)
     SELECT UNNEST($1::uuid[]), $2, UNNEST($3::text[]), UNNEST($4::text[])`,
    [
      batch.map(s => s.id),
      orgId,
      batch.map(s => s.firstName),
      batch.map(s => s.lastName),
    ],
  );
}

interface EnrollmentRow {
  id:        string;
  studentId: string;
  classId:   string;
  sectionId: string;
}

async function insertEnrollmentBatch(
  client:  PoolClient,
  orgId:   string,
  batch:   EnrollmentRow[],
): Promise<void> {
  await client.query(
    `INSERT INTO student_enrollments
       (id, organization_id, student_id, class_id, section_id, academic_year)
     SELECT
       UNNEST($1::uuid[]),
       $2,
       UNNEST($3::uuid[]),
       UNNEST($4::uuid[]),
       UNNEST($5::uuid[]),
       $6`,
    [
      batch.map(r => r.id),
      orgId,
      batch.map(r => r.studentId),
      batch.map(r => r.classId),
      batch.map(r => r.sectionId),
      ACADEMIC_YEAR,
    ],
  );
}

interface AttendanceRow {
  studentId:    string;
  enrollmentId: string;
  date:         string;
  status:       string;
}

/** Returns count of rows inserted by this batch. */
async function insertAttendanceBatch(
  client: PoolClient,
  orgId:  string,
  batch:  AttendanceRow[],
): Promise<number> {
  const { rowCount } = await client.query(
    `INSERT INTO attendance
       (organization_id, student_id, enrollment_id, attendance_date, status)
     SELECT $1, UNNEST($2::uuid[]), UNNEST($3::uuid[]), UNNEST($4::date[]), UNNEST($5::text[])
     ON CONFLICT (organization_id, student_id, attendance_date) DO NOTHING`,
    [
      orgId,
      batch.map(r => r.studentId),
      batch.map(r => r.enrollmentId),
      batch.map(r => r.date),
      batch.map(r => r.status),
    ],
  );
  return rowCount ?? 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startMs  = Date.now();
  const client   = await pool.connect();

  const totalSections = NUM_CLASSES * SECTIONS_PER_CLASS;
  const totalStudents = totalSections * STUDENTS_PER_SECTION;
  const totalAtt      = totalStudents * ATTENDANCE_DAYS;

  console.log('══════════════════════════════════════════════════');
  console.log('  SAMA-SUITE Attendance Validation Seeder  [10k]');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Org code   : ${SEED_ORG_CODE}`);
  console.log(`  Classes    : ${NUM_CLASSES}`);
  console.log(`  Sections   : ${totalSections}`);
  console.log(`  Students   : ${totalStudents}`);
  console.log(`  Att rows   : ${totalAtt}`);
  console.log('');

  try {

    // ──────────────────────────────────────────────────────────────────────────
    // DESTRUCTIVE OPERATION GUARDRAIL
    // Runs before any DELETE.  Throws on two independent conditions so that
    // neither check can be bypassed by satisfying only the other.
    // ──────────────────────────────────────────────────────────────────────────

    if (process.env.NODE_ENV === 'production') {
      throw new Error('Seeder blocked in production');
    }

    if (!SEED_ORG_CODE.startsWith('SEED-')) {
      throw new Error('Unsafe org code — aborting destructive seed');
    }

    console.warn('⚠ Destructive seed in non-production environment');

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1 — Clean previous seed data
    // Dependency order: attendance → student_enrollments → students
    //                 → sections  → classes → organizations
    // ──────────────────────────────────────────────────────────────────────────

    process.stdout.write('[1/6] Checking for previous seed data… ');

    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE code = $1 LIMIT 1`,
      [SEED_ORG_CODE],
    );

    if (existing.length > 0) {
      const prevOrgId = existing[0].id;
      process.stdout.write(`found (${prevOrgId}). Deleting…\n`);

      const tables = [
        'attendance',
        'student_enrollments',
        'students',
        'sections',
        'classes',
      ] as const;

      for (const table of tables) {
        const { rowCount } = await client.query(
          `DELETE FROM ${table} WHERE organization_id = $1`,
          [prevOrgId],
        );
        console.log(`    ✓ ${table}: ${rowCount ?? 0} rows deleted`);
      }

      await client.query(`DELETE FROM organizations WHERE id = $1`, [prevOrgId]);
      console.log(`    ✓ organizations: 1 row deleted`);
    } else {
      console.log('none found.');
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2 — Organisation
    // ──────────────────────────────────────────────────────────────────────────

    process.stdout.write('\n[2/6] Creating organisation… ');

    const orgId = uuidv4();
    await client.query(
      `INSERT INTO organizations (id, name, code, industry_type)
       VALUES ($1, $2, $3, 'EDUCATION')`,
      [orgId, SEED_ORG_NAME, SEED_ORG_CODE],
    );

    console.log(`done.  org_id = ${orgId}`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3 — Classes + Sections
    // 250 rows total — individual inserts are fine at this scale.
    // ──────────────────────────────────────────────────────────────────────────

    process.stdout.write('\n[3/6] Creating classes and sections… ');

    /** sectionId → { classId, sectionName } */
    const sectionMeta: Map<string, { classId: string; sectionName: string }> = new Map();
    const orderedSectionIds: string[] = [];

    for (let ci = 0; ci < NUM_CLASSES; ci++) {
      const classId = uuidv4();

      await client.query(
        `INSERT INTO classes (id, organization_id, name) VALUES ($1, $2, $3)`,
        [classId, orgId, CLASS_NAMES[ci]],
      );

      for (let si = 0; si < SECTIONS_PER_CLASS; si++) {
        const sectionId = uuidv4();

        await client.query(
          `INSERT INTO sections (id, organization_id, class_id, name)
           VALUES ($1, $2, $3, $4)`,
          [sectionId, orgId, classId, SECTION_NAMES[si]],
        );

        sectionMeta.set(sectionId, { classId, sectionName: SECTION_NAMES[si] });
        orderedSectionIds.push(sectionId);
      }
    }

    console.log(`${NUM_CLASSES} classes, ${orderedSectionIds.length} sections.`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4 — Students (batched UNNEST inserts, 500 rows/round-trip)
    // ──────────────────────────────────────────────────────────────────────────

    process.stdout.write('\n[4/6] Creating students… ');

    interface StudentRecord extends StudentRow {
      sectionId: string;
    }

    const allStudents: StudentRecord[] = [];

    for (let sIdx = 0; sIdx < orderedSectionIds.length; sIdx++) {
      const sectionId = orderedSectionIds[sIdx];
      for (let stuIdx = 0; stuIdx < STUDENTS_PER_SECTION; stuIdx++) {
        const globalIdx               = sIdx * STUDENTS_PER_SECTION + stuIdx;
        const { firstName, lastName } = nameAt(globalIdx);
        allStudents.push({ id: uuidv4(), firstName, lastName, sectionId });
      }
    }

    let stuBatch = 0;
    const stuTotal = Math.ceil(allStudents.length / STU_BATCH_SIZE);
    for (let i = 0; i < allStudents.length; i += STU_BATCH_SIZE) {
      stuBatch++;
      process.stdout.write(`\r[4/6] Student batch ${stuBatch}/${stuTotal}   `);
      await insertStudentBatch(client, orgId, allStudents.slice(i, i + STU_BATCH_SIZE));
    }
    process.stdout.write(`\r[4/6] ${allStudents.length} students inserted.        \n`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5 — Student enrollments (batched UNNEST inserts, 500 rows/round-trip)
    // ──────────────────────────────────────────────────────────────────────────

    process.stdout.write('\n[5/6] Creating enrollments… ');

    const allEnrollments: EnrollmentRow[]              = [];
    const enrollmentIdByStudentId: Map<string, string> = new Map();

    for (const student of allStudents) {
      const meta         = sectionMeta.get(student.sectionId)!;
      const enrollmentId = uuidv4();
      allEnrollments.push({
        id:        enrollmentId,
        studentId: student.id,
        classId:   meta.classId,
        sectionId: student.sectionId,
      });
      enrollmentIdByStudentId.set(student.id, enrollmentId);
    }

    let enrBatch = 0;
    const enrTotal = Math.ceil(allEnrollments.length / ENR_BATCH_SIZE);
    for (let i = 0; i < allEnrollments.length; i += ENR_BATCH_SIZE) {
      enrBatch++;
      process.stdout.write(`\r[5/6] Enrollment batch ${enrBatch}/${enrTotal}   `);
      await insertEnrollmentBatch(client, orgId, allEnrollments.slice(i, i + ENR_BATCH_SIZE));
    }
    process.stdout.write(`\r[5/6] ${allEnrollments.length} enrollments inserted.        \n`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 6 — Attendance records (batched, 1,000 rows/round-trip)
    // 10,000 students × 7 days = 70,000 rows in 70 batches.
    // ──────────────────────────────────────────────────────────────────────────

    process.stdout.write('\n[6/6] Creating attendance records… ');

    const dates = pastDates(ATTENDANCE_DAYS);

    const allAttendance: AttendanceRow[] = [];

    for (const date of dates) {
      for (const student of allStudents) {
        allAttendance.push({
          studentId:    student.id,
          enrollmentId: enrollmentIdByStudentId.get(student.id)!,
          date,
          status:       randomStatus(),
        });
      }
    }

    let attInserted  = 0;
    let batchNumber  = 0;
    const totalBatches = Math.ceil(allAttendance.length / ATT_BATCH_SIZE);

    for (let i = 0; i < allAttendance.length; i += ATT_BATCH_SIZE) {
      batchNumber++;
      const batch    = allAttendance.slice(i, i + ATT_BATCH_SIZE);
      const inserted = await insertAttendanceBatch(client, orgId, batch);
      attInserted   += inserted;
      process.stdout.write(`\r[6/6] Attendance batch ${batchNumber}/${totalBatches} — ${attInserted} rows inserted   `);
    }
    process.stdout.write('\n');

    // ──────────────────────────────────────────────────────────────────────────
    // Summary
    // ──────────────────────────────────────────────────────────────────────────

    const durationMs = Date.now() - startMs;

    console.log('\n══════════════════════════════════════════════════');
    console.log('  SEED COMPLETE');
    console.log('══════════════════════════════════════════════════');
    console.log(`  Organisation ID  : ${orgId}`);
    console.log(`  Students         : ${allStudents.length}`);
    console.log(`  Enrollments      : ${allEnrollments.length}`);
    console.log(`  Attendance rows  : ${attInserted}`);
    console.log(`  Duration         : ${durationMs} ms`);
    console.log('══════════════════════════════════════════════════');
    console.log('');
    console.log('  Copy this org_id into your EXPLAIN ANALYZE queries:');
    console.log(`  ${orgId}`);
    console.log('');
    console.log('  Sample section IDs (40 students each):');
    orderedSectionIds.slice(0, 3).forEach((id, i) => {
      const meta = sectionMeta.get(id)!;
      console.log(`  section[${i}] ${meta.sectionName} → ${id}`);
    });
    console.log('');

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error('\n✗ Seeder failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
