'use strict';

const OpenAI    = require('openai');
const { toFile } = require('openai');

// ============================================================
// SUPPORTED FORMATS (Whisper API limit)
// ============================================================

const ALLOWED_MIMETYPES = new Set([
  'audio/flac', 'audio/m4a',  'audio/mp3',  'audio/mp4',
  'audio/mpeg', 'audio/mpga', 'audio/oga',  'audio/ogg',
  'audio/wav',  'audio/webm', 'audio/x-wav', 'audio/x-m4a',
]);

// ============================================================
// LAZY CLIENT
// Initialised once; throws 503 if the env var is absent so the
// error surfaces clearly at call time rather than at boot.
// ============================================================

let _client = null;

function getClient() {
  if (_client) return _client;

  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY environment variable is not configured');
    err.statusCode = 503;
    throw err;
  }

  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

// ============================================================
// TRANSCRIBE
//
// Accepts the multer file object { buffer, mimetype, originalname }.
// Returns the transcribed text string (trimmed).
// Throws with statusCode on validation or API errors.
// ============================================================

async function transcribeAudio({ buffer, mimetype, originalname }) {
  if (!ALLOWED_MIMETYPES.has(mimetype)) {
    const err = new Error(
      `Unsupported audio format: "${mimetype}". ` +
      `Accepted: ${[...ALLOWED_MIMETYPES].join(', ')}`
    );
    err.statusCode = 415;
    throw err;
  }

  const client = getClient();

  // toFile wraps the buffer so the OpenAI SDK can stream it
  const file = await toFile(
    buffer,
    originalname || 'audio.wav',
    { type: mimetype }
  );

  const { text } = await client.audio.transcriptions.create({
    model:  'whisper-1',
    file,
    // language intentionally omitted — Whisper auto-detects
  });

  return text ? text.trim() : '';
}

module.exports = { transcribeAudio };
