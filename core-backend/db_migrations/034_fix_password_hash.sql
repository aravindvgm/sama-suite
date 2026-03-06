-- Migration 034: Fix missing password_hash column in Render production DB
-- Safe to run multiple times

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_hash TEXT;

UPDATE users
SET password_hash = password
WHERE password_hash IS NULL AND password IS NOT NULL;