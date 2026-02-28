'use strict';

const { transcribeAudio }  = require('../../utils/whisper.service');
const { answerQuestion }   = require('./principalAssistant.service');
const { insertConversation } = require('./assistantConversation.service');

// POST /ai/assistant/speech
// Accepts multipart/form-data with an "audio" field.
// Transcribes → passes transcript to answerQuestion → returns full
// assistant response with the transcript included.

async function speechToAssistant(req, res) {
  const { organizationId, id: userId } = req.user;

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'Audio file is required. Send as multipart/form-data with field name "audio".',
    });
  }

  try {
    // ── STT ──────────────────────────────────────────────────
    const transcript = await transcribeAudio(req.file);

    if (!transcript) {
      return res.status(422).json({
        success: false,
        message: 'Could not transcribe audio — please speak clearly and try again.',
      });
    }

    // ── Answer ───────────────────────────────────────────────
    const result = await answerQuestion({ organizationId, userId, question: transcript });

    // ── Persist history fire-and-forget ──────────────────────
    insertConversation({
      organizationId,
      userId:   userId || null,
      question: result.question,
      answer:   result.answer,
      intent:   result.intent,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      data:    { transcript, ...result },
    });

  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('speechToAssistant error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { speechToAssistant };
