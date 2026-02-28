-- =============================================================
-- 014_create_parent_students.sql
-- Links parent users to their children (students).
-- One parent (user_id) can be linked to multiple students.
-- One student can have multiple parents.
-- =============================================================

CREATE TABLE IF NOT EXISTS parent_students (
  id               UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID      NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID      NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  student_id       UUID      NOT NULL REFERENCES students(id)      ON DELETE CASCADE,
  relationship     VARCHAR(20) NOT NULL DEFAULT 'PARENT',          -- FATHER | MOTHER | GUARDIAN | PARENT
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_parent_student UNIQUE (organization_id, user_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_parent_students_user   ON parent_students (user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_parent_students_student ON parent_students (student_id, organization_id);
