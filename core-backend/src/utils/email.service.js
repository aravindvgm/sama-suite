'use strict';

/**
 * email.service.js
 *
 * Thin SMTP wrapper for Phase-9.A risk notification emails.
 *
 * nodemailer is an OPTIONAL dependency — if not installed the module
 * degrades gracefully: sendEmail() always resolves with { ok: false,
 * reason: 'NODEMAILER_NOT_INSTALLED' } and logs a WARN.
 *
 * Environment variables (all optional — defaults are shown):
 *   SMTP_HOST    — SMTP server hostname       (default: localhost)
 *   SMTP_PORT    — SMTP server port           (default: 587)
 *   SMTP_SECURE  — 'true' for TLS on connect  (default: false / STARTTLS)
 *   SMTP_USER    — SMTP auth username          (default: none)
 *   SMTP_PASS    — SMTP auth password          (default: none)
 *   SMTP_FROM    — From address               (default: noreply@samatechnologies.com)
 *
 * Usage:
 *   const { sendEmail } = require('../utils/email.service');
 *   const result = await sendEmail({ to, subject, html, text });
 *   // result: { ok: true, messageId } | { ok: false, reason }
 */

const logger = require('./logger');

// ── Lazy-require nodemailer ────────────────────────────────────────────────────
// nodemailer is listed as an optional peer dependency.
// The try/catch here lets the rest of the application start normally even when
// the package is absent (e.g. in environments that only use WhatsApp delivery).

let nodemailer = null;

try {
  nodemailer = require('nodemailer');
} catch (_) {
  // nodemailer not installed — email sending is disabled.
  // sendEmail() will return { ok: false, reason: 'NODEMAILER_NOT_INSTALLED' }.
}

// ── SMTP transport singleton ──────────────────────────────────────────────────
// Created on first sendEmail() call and reused for the lifetime of the process.
// Nodemailer manages the underlying TCP connection pool internally.

let _transport = null;

function _getTransport() {
  if (_transport) return _transport;
  if (!nodemailer) return null;

  _transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST || 'localhost',
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   (process.env.SMTP_USER && process.env.SMTP_PASS)
              ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
              : undefined,
  });

  return _transport;
}

// ── Send ──────────────────────────────────────────────────────────────────────

/**
 * sendEmail({ to, subject, html, text })
 *
 * Fire-and-forget safe — always resolves, never rejects.
 * Callers should inspect result.ok to determine success.
 *
 * @param {{ to: string, subject: string, html: string, text: string }} opts
 * @returns {Promise<{ ok: true, messageId: string } | { ok: false, reason: string }>}
 */
async function sendEmail({ to, subject, html, text }) {
  if (!nodemailer) {
    logger.warn('email.service: nodemailer not installed — email sending disabled', {
      to,
      subject,
    });
    return { ok: false, reason: 'NODEMAILER_NOT_INSTALLED' };
  }

  const transport = _getTransport();
  if (!transport) {
    return { ok: false, reason: 'TRANSPORT_UNAVAILABLE' };
  }

  const from = process.env.SMTP_FROM || 'noreply@samatechnologies.com';

  try {
    const info = await transport.sendMail({ from, to, subject, html, text });
    logger.info('email.service: email sent', {
      to,
      subject,
      messageId: info.messageId,
    });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    logger.error('email.service: send failed', {
      to,
      subject,
      error: err.message,
    });
    return { ok: false, reason: err.message };
  }
}

module.exports = { sendEmail };
