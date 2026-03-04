-- ============================================================
-- MIGRATION 031: Classes, Sections, Student Enrollments, Attendance
-- ============================================================
--
-- Creates the foundational schema for the Attendance vertical:
--
--   classes              — one row per class (e.g. "Grade 5") per org
--   sections             — one row per section within a class (e.g. "A")
--   student_enrollments  — places a student into a class/section for an
--                          academic year; prevents double-enrollment
--   attendance           — one row per (student, date) per org;
--                          UNIQUE constraint enables bulk UPSERT via
--                          INSERT … ON CONFLICT DO UPDATE (idempotent)
--
-- Phase 1 — transactional DDL (BEGIN / COMMIT)
-- Phase 2 — CONCURRENTLY indexes (outside transaction)
-- ============================================================


-- ═══════════════════════════════════════════════════════════════
-- PHASE 1 — Transactional schema changes
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── classes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS classes (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  created_by       UUID         REFERENCES users(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID         REFERENCES users(id)
);

COMMENT ON TABLE classes IS
  'One row per class (e.g. Grade 5) per organisation. '
  'Soft-deleted via deleted_at. Each org manages its own class list.';


-- ── sections ──────────────────────────────────────────────────
-- A section belongs to exactly one class within the same org.
-- Example: class="Grade 5", section="A" or "B".

CREATE TABLE IF NOT EXISTS sections (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  class_id         UUID         NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  created_by       UUID         REFERENCES users(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID         REFERENCES users(id)
);

COMMENT ON TABLE sections IS
  'One row per section (e.g. "A") within a class. '
  'organization_id is denormalised for tenant-scoped index coverage.';


-- ── student_enrollments ───────────────────────────────────────
-- Links a student to a class/section for a specific academic year.
-- Unique constraint: a student may be enrolled in the same class
-- only once per academic year within an org.
-- section_id is nullable: enrollment without section is valid.

CREATE TABLE IF NOT EXISTS student_enrollments (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id       UUID        NOT NULL REFERENCES students(id),
  class_id         UUID        NOT NULL REFERENCES classes(id),
  section_id       UUID        REFERENCES sections(id),

  -- "2024-2025" format (Indian academic year April–March).
  -- Enforced by application layer; no DB CHECK to allow flexibility.
  academic_year    VARCHAR(9)  NOT NULL,

  created_by       UUID        REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID        REFERENCES users(id),

  -- Prevents double-enrollment in the same class for the same year.
  -- A student may be enrolled in different classes (e.g. after re-grade).
  UNIQUE (organization_id, student_id, class_id, academic_year)
);

COMMENT ON TABLE student_enrollments IS
  'Places a student in a class/section for one academic year. '
  'UNIQUE (org, student, class, year) prevents duplicate active enrollments. '
  'section_id nullable — sections are optional.';


-- ── attendance ────────────────────────────────────────────────
-- One row per (student, date) per org.
-- UNIQUE (organization_id, student_id, attendance_date) enables the
-- bulk UPSERT used by POST /attendance/bulk:
--   INSERT … ON CONFLICT (org, student, date) DO UPDATE SET status, updated_at
-- This makes bulk mark fully idempotent — safe to retry on network failure.

CREATE TABLE IF NOT EXISTS attendance (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  student_id       UUID         NOT NULL REFERENCES students(id),
  enrollment_id    UUID         NOT NULL REFERENCES student_enrollments(id),
  attendance_date  DATE         NOT NULL,

  -- DB-enforced enum so invalid values are rejected even on direct DB writes.
  status           VARCHAR(10)  NOT NULL
                     CHECK (status IN ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED')),

  created_by       UUID         REFERENCES users(id),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID         REFERENCES users(id),

  -- One attendance record per student per calendar date.
  -- ON CONFLICT target for the bulk UPSERT in attendance.service.js.
  UNIQUE (organization_id, student_id, attendance_date)
);

COMMENT ON TABLE attendance IS
  'One row per student per calendar date per org. '
  'UNIQUE (org, student, date) enables INSERT … ON CONFLICT DO UPDATE (idempotent bulk mark). '
  'Soft-deleted rows are treated as absent by the dashboard query.';

COMMENT ON COLUMN attendance.status IS
  'PRESENT: student attended. ABSENT: did not attend. '
  'LATE: arrived late (counted present for % purposes). '
  'EXCUSED: authorised absence (excluded from absent % in some views).';


-- ── Permission seed ───────────────────────────────────────────
-- Adds attendance CRUD permissions to the global permissions table.
-- ON CONFLICT DO NOTHING is idempotent — re-runs are safe.

INSERT INTO permissions (module, action)
VALUES
  ('attendance', 'create'),
  ('attendance', 'read'),
  ('attendance', 'update'),
  ('attendance', 'delete')
ON CONFLICT (module, action) DO NOTHING;

COMMIT;


-- ═══════════════════════════════════════════════════════════════
-- PHASE 2 — CONCURRENTLY indexes (outside transaction)
-- IF NOT EXISTS guards make re-runs safe.
-- Partial predicates use IS NULL (stable — not volatile like NOW()).
-- ═══════════════════════════════════════════════════════════════

-- ── classes ───────────────────────────────────────────────────
-- getClasses: SELECT … WHERE organization_id = $1 AND deleted_at IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cls_org_active
  ON classes (organization_id)
  WHERE deleted_at IS NULL;


-- ── sections ──────────────────────────────────────────────────
-- getSectionsByClass: WHERE organization_id=$1 AND class_id=$2 AND deleted_at IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sec_org_class_active
  ON sections (organization_id, class_id)
  WHERE deleted_at IS NULL;


-- ── student_enrollments ───────────────────────────────────────
-- Teacher roster: JOIN student_enrollments WHERE org=$1 AND section_id=$2 AND deleted_at IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_se_org_section_active
  ON student_enrollments (organization_id, section_id)
  WHERE deleted_at IS NULL;

-- Parent / student view: WHERE org=$1 AND student_id=$2 AND deleted_at IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_se_org_student_active
  ON student_enrollments (organization_id, student_id)
  WHERE deleted_at IS NULL;


-- ── attendance ────────────────────────────────────────────────
-- Dashboard stats: WHERE organization_id=$1 AND attendance_date=$2 AND deleted_at IS NULL
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_att_org_date
  ON attendance (organization_id, attendance_date)
  WHERE deleted_at IS NULL;

-- Parent 7-day history: WHERE org=$1 AND student_id=$2 AND date >= … AND deleted_at IS NULL
-- DESC on attendance_date matches ORDER BY attendance_date DESC in the query.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_att_org_student_date
  ON attendance (organization_id, student_id, attendance_date DESC)
  WHERE deleted_at IS NULL;

-- Repeat absentee query: WHERE org=$1 AND date BETWEEN … AND status='ABSENT' AND deleted_at IS NULL
-- Partial on ABSENT reduces index size — typical attendance is mostly PRESENT.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_att_org_date_absent
  ON attendance (organization_id, attendance_date)
  WHERE status = 'ABSENT' AND deleted_at IS NULL;
