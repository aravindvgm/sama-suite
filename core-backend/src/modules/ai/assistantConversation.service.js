'use strict';

const pool = require('../../config/db');

// ============================================================
// INSERT — called fire-and-forget from principalAssistant.controller
// after every successful answerQuestion() response.
//
// Never throws — logging must never interrupt the API response.
// ============================================================

async function insertConversation({
  organizationId,
  userId,
  question,
  answer,
  intent,
}) {
  try {
    await pool.query(
      `INSERT INTO assistant_conversations
         (organization_id, user_id, question, answer, intent)
       VALUES ($1, $2, $3, $4, $5)`,
      [organizationId, userId || null, question, answer, intent || null]
    );
  } catch (err) {
    // Non-fatal — a logging failure must never block the caller
    console.error('[AssistantConversation] Failed to persist conversation:', err.message);
  }
}

// ============================================================
// HISTORY — GET /ai/assistant/history
//
// Returns the 20 most recent conversations for the organisation.
// Strictly org-scoped; user_id filtering is left to the caller
// if per-user views are needed in the future.
// ============================================================

async function getConversationHistory({ organizationId }) {
  const { rows } = await pool.query(
    `SELECT
       id,
       user_id,
       question,
       answer,
       intent,
       created_at
     FROM   assistant_conversations
     WHERE  organization_id = $1
     ORDER  BY created_at DESC
     LIMIT  20`,
    [organizationId]
  );

  return rows;
}

module.exports = { insertConversation, getConversationHistory };
