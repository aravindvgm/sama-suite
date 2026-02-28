'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const stream = require('stream');

const { answerQuestion }     = require('./principalAssistant.service');
const { insertConversation } = require('./assistantConversation.service');
const { textToSpeech }       = require('../../utils/tts.service');
const { findCachedAudio, saveCachedAudio } = require('./assistantAudioCache.service');

// POST /ai/assistant/speech-response
//
// First request  → OpenAI TTS called, MP3 written to disk + streamed to client,
//                  DB cache entry saved.
// Second request → MP3 served directly from disk, zero OpenAI cost.
//
// Cache key = SHA-256(intent + answer + model + voice)
// Scope: per-organisation so orgs never share audio files.

async function speechResponseToAssistant(req, res) {
  const { organizationId, id: userId } = req.user;
  const { question }                   = req.body;

  try {
    // ── Answer ───────────────────────────────────────────────
    const result = await answerQuestion({ organizationId, userId, question });

    // ── Persist history fire-and-forget ──────────────────────
    insertConversation({
      organizationId,
      userId:   userId || null,
      question: result.question,
      answer:   result.answer,
      intent:   result.intent,
    }).catch(() => {});

    // ── Cache key ─────────────────────────────────────────────
    const cacheKey = crypto
      .createHash('sha256')
      .update(
        result.intent + ':' +
        result.answer + ':' +
        (process.env.OPENAI_TTS_MODEL || 'tts-1') + ':' +
        (process.env.OPENAI_TTS_VOICE || 'nova')
      )
      .digest('hex');

    // ── Cache hit ─────────────────────────────────────────────
    const cached = await findCachedAudio({ organizationId, cacheKey });

    if (cached) {
      const filePath = path.resolve(cached.audio_path);

      if (fs.existsSync(filePath)) {
        res.set({
          'Content-Type':       'audio/mpeg',
          'X-Assistant-Intent': result.intent,
          'X-Cache-Hit':        'true',
        });
        return fs.createReadStream(filePath).pipe(res);
      }
      // File missing from disk (deleted externally) — fall through to regenerate
    }

    // ── Cache miss — generate via OpenAI TTS ─────────────────
    const audioStream = await textToSpeech(result.answer);

    // Ensure storage folder exists
    const cacheDir = path.resolve('storage/audio_cache');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const savePath   = path.join(cacheDir, cacheKey + '.mp3');
    const fileStream = fs.createWriteStream(savePath);

    res.set({
      'Content-Type':         'audio/mpeg',
      'Transfer-Encoding':    'chunked',
      'X-Assistant-Intent':   result.intent,
      'X-Assistant-Question': result.question,
      'X-Context-Resolved':   String(result.contextResolved),
      'X-Cache-Hit':          'false',
    });

    audioStream.on('error', console.error);
    audioStream.pipe(fileStream);
    audioStream.pipe(res);

    fileStream.on('finish', async () => {
      await saveCachedAudio({
        organizationId,
        cacheKey,
        question:  result.question,
        answer:    result.answer,
        audioPath: savePath,
      });
    });

  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('speechResponseToAssistant error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { speechResponseToAssistant };
