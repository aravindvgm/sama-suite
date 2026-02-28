'use strict';

/**
 * whatsapp.service.js
 *
 * Placeholder WhatsApp/SMS gateway integration.
 *
 * Swap the simulation block inside sendWhatsAppMessage() with a real
 * provider SDK when ready, e.g.:
 *
 *   Twilio:
 *     const client = require('twilio')(SID, TOKEN);
 *     await client.messages.create({ from: 'whatsapp:+14155238886',
 *                                    to:   `whatsapp:${contactNumber}`,
 *                                    body: message });
 *
 *   Interakt / Gupshup / Meta WABA:
 *     await axios.post(PROVIDER_URL, { phone: contactNumber, message }, { headers });
 */

/**
 * Send a WhatsApp or SMS message to the given contact.
 *
 * @param {string} contactNumber  - E.164 or local format, e.g. "+919876543210"
 * @param {string} message        - Plain-text message body
 * @returns {Promise<{ success: boolean, messageId: string|null }>}
 */
async function sendWhatsAppMessage(contactNumber, message) {
  // ── SIMULATION ─────────────────────────────────────────────
  // Replace this block with the live provider SDK call.
  console.log(`[WhatsApp] → ${contactNumber}`);
  console.log(`[WhatsApp]   ${message}`);

  // Simulate occasional send failure for testing retry logic (~10%)
  if (process.env.SIMULATE_WHATSAPP_FAILURE === 'true' && Math.random() < 0.1) {
    throw new Error('Simulated gateway failure');
  }

  const messageId = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { success: true, messageId };
  // ── END SIMULATION ─────────────────────────────────────────
}

/**
 * Send a WhatsApp audio message (MP3) to the given contact.
 *
 * @param {string} contactNumber - E.164 or local format
 * @param {string} audioPath     - Absolute path to the MP3 file on disk
 * @param {string} caption       - Optional caption shown below the audio
 * @returns {Promise<{ success: boolean, messageId: string|null }>}
 */
async function sendWhatsAppAudio(contactNumber, audioPath, caption = '') {
  // ── SIMULATION ─────────────────────────────────────────────
  // Replace with live provider SDK call, e.g.:
  //
  //   Meta WABA / Interakt:
  //     const publicUrl = await uploadToStorage(audioPath); // S3 / GCS
  //     await axios.post(PROVIDER_URL, {
  //       phone: contactNumber, type: 'audio',
  //       audio: { link: publicUrl }, caption,
  //     }, { headers });
  //
  //   Twilio:
  //     await client.messages.create({
  //       from: 'whatsapp:+14155238886', to: `whatsapp:${contactNumber}`,
  //       mediaUrl: [publicUrl], body: caption,
  //     });
  console.log(`[WhatsApp:Audio] → ${contactNumber}`);
  console.log(`[WhatsApp:Audio]   file=${audioPath}  caption="${caption}"`);

  if (process.env.SIMULATE_WHATSAPP_FAILURE === 'true' && Math.random() < 0.1) {
    throw new Error('Simulated gateway failure');
  }

  const messageId = `sim_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { success: true, messageId };
  // ── END SIMULATION ─────────────────────────────────────────
}

module.exports = { sendWhatsAppMessage, sendWhatsAppAudio };
