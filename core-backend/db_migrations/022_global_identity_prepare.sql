/**
 * MIGRATION 022: Global Identity — Enforce globally unique emails
 *
 * loginUser now resolves users by email alone (no org scope at credential-check time).
 * This index prevents duplicate accounts across organizations and makes the
 * WHERE LOWER(email) = LOWER($1) lookup in auth.service.js safe and unambiguous.
 *
 * IF NOT EXISTS makes this idempotent on re-runs.
 * The partial expression index on LOWER(email) matches the query predicate exactly.
 *
 * No columns dropped. No schema altered. No foreign keys modified.
 */

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON users (LOWER(email));
