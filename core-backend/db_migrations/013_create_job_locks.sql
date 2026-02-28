-- =============================================================
-- 013_create_job_locks.sql
-- Distributed job lock table — prevents duplicate cron execution
-- across multiple server instances.
-- =============================================================

CREATE TABLE IF NOT EXISTS job_locks (
  job_name      VARCHAR(100) PRIMARY KEY,
  locked_by     VARCHAR(255) NOT NULL,          -- hostname:pid
  locked_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMP    NOT NULL,
  last_run_at   TIMESTAMP    NULL,
  last_run_status VARCHAR(10) NULL              -- SUCCESS | FAILED
);
