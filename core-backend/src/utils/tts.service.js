'use strict';

const OpenAI    = require('openai');
const { Readable } = require('stream');

// ============================================================
// LAZY CLIENT  (same pattern as whisper.service.js)
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
// TEXT-TO-SPEECH
//
// Converts text to an MP3 audio stream via OpenAI TTS API.
// Returns a Node.js Readable stream ready to pipe into res.
//
// Configurable via env:
//   OPENAI_TTS_MODEL  — tts-1 (default, fast) | tts-1-hd (higher quality)
//   OPENAI_TTS_VOICE  — alloy | echo | fable | nova (default) | onyx | shimmer
// ============================================================

const MAX_INPUT_CHARS = 4096; // OpenAI TTS API hard limit

async function textToSpeech(text) {
  if (!text || !text.trim()) {
    const err = new Error('Text is required for speech synthesis');
    err.statusCode = 422;
    throw err;
  }

  const input  = text.length > MAX_INPUT_CHARS ? text.slice(0, MAX_INPUT_CHARS) : text;
  const client = getClient();

  const response = await client.audio.speech.create({
    model:           process.env.OPENAI_TTS_MODEL || 'tts-1',
    voice:           process.env.OPENAI_TTS_VOICE || 'nova',
    input,
    response_format: 'mp3',
  });

  // Convert Web ReadableStream → Node.js Readable for piping into res
  return Readable.fromWeb(response.body);
}

module.exports = { textToSpeech };
