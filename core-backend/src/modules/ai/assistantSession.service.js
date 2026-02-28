'use strict';

const pool = require('../../config/db');

// ============================================================
// GET — load the active session for a user.
// Returns the row or null.  Never throws — callers treat a
// missing session as "no context available".
// ============================================================

async function getSession({ organizationId, userId }) {
  if (!userId) return null;

  try {
    const { rows } = await pool.query(
      `SELECT last_intent, context_json, updated_at
       FROM   assistant_sessions
       WHERE  organization_id = $1
         AND  user_id         = $2`,
      [organizationId, userId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[AssistantSession] Failed to load session:', err.message);
    return null;
  }
}

// ============================================================
// UPSERT — save (or refresh) context after every response.
//
// Called fire-and-forget — must never throw or block the caller.
// Anonymous callers (no userId) are skipped silently.
// ============================================================

async function upsertSession({ organizationId, userId, intent, contextJson }) {
  if (!userId) return;

  try {
    await pool.query(
      `INSERT INTO assistant_sessions
         (organization_id, user_id, last_intent, context_json, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (organization_id, user_id)
       DO UPDATE SET
         last_intent  = EXCLUDED.last_intent,
         context_json = EXCLUDED.context_json,
         updated_at   = NOW()`,
      [organizationId, userId, intent, JSON.stringify(contextJson)]
    );
  } catch (err) {
    console.error('[AssistantSession] Failed to upsert session:', err.message);
  }
}

module.exports = { getSession, upsertSession };
