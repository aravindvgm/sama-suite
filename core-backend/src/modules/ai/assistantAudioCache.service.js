'use strict';

const pool = require('../../config/db');

// ============================================================
// FIND — lookup a cached audio entry by (org, cache_key).
// Returns the row or null.
// ============================================================

async function findCachedAudio({ organizationId, cacheKey }) {
  const { rows } = await pool.query(
    `SELECT id, question, answer, audio_path
     FROM   assistant_audio_cache
     WHERE  organization_id = $1
       AND  cache_key       = $2
     LIMIT  1`,
    [organizationId, cacheKey]
  );
  return rows[0] || null;
}

// ============================================================
// SAVE — persist a new cache entry after the MP3 is written.
// ON CONFLICT DO UPDATE handles the rare race where two identical
// requests complete at the same time.
// ============================================================

async function saveCachedAudio({ organizationId, cacheKey, question, answer, audioPath }) {
  await pool.query(
    `INSERT INTO assistant_audio_cache
       (organization_id, cache_key, question, answer, audio_path)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, cache_key)
     DO UPDATE SET audio_path = EXCLUDED.audio_path`,
    [organizationId, cacheKey, question, answer, audioPath]
  );
}

module.exports = { findCachedAudio, saveCachedAudio };
