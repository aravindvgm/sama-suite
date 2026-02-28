/**
 * MIGRATION: Add parent contact fields to students table
 *
 * Required by the fee reminder worker to resolve the contact
 * number to notify (father_mobile, mother_mobile, primary_contact).
 */

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS father_mobile    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS mother_mobile    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS primary_contact  VARCHAR(10) DEFAULT 'FATHER';

COMMENT ON COLUMN students.father_mobile   IS 'Father mobile number for fee reminders / notifications.';
COMMENT ON COLUMN students.mother_mobile   IS 'Mother mobile number for fee reminders / notifications.';
COMMENT ON COLUMN students.primary_contact IS 'FATHER or MOTHER — determines which number receives automated reminders.';
