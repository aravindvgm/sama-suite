'use strict';

/**
 * riskEmail.renderer.js
 *
 * Phase-9.A — HTML + plain-text email renderer for risk notification emails.
 *
 * STRICTLY EXCLUDED from all generated email content:
 *   ✗ IP addresses or network identifiers
 *   ✗ API endpoint paths or URL patterns
 *   ✗ Email addresses (recipient or subject user)
 *   ✗ Phone numbers
 *   ✗ Student records or academic data
 *   ✗ Financial transactions or fee data
 *   ✗ Device fingerprints or user-agent strings
 *   ✗ Raw signal scores beyond the aggregate risk score
 *
 * The email is AWARENESS ONLY — it conveys that a risk case exists and
 * instructs the recipient to log in to the Security Operations dashboard.
 * No sensitive operational details are included.
 *
 * Usage:
 *   const { renderEmail } = require('./riskEmail.renderer');
 *   const { subject, html, text } = renderEmail({ organizationName, ... });
 */

// ── Signal label map ───────────────────────────────────────────────────────────
// Maps machine signal_type identifiers to human-readable descriptions.
// Labels describe the category of behavior, not the specific data accessed.

const SIGNAL_LABELS = {
  ENUMERATION:             'Bulk Data Enumeration',
  EXPORT_SPIKE:            'Unusual Export Activity',
  SENSITIVE_CONCENTRATION: 'Sensitive Area Concentration',
  OFF_HOURS:               'Off-Hours Access Pattern',
  ROLE_DEVIATION:          'Role-Deviation Access Pattern',
};

// ── Risk level display ─────────────────────────────────────────────────────────

const RISK_COLORS = {
  CRITICAL: '#c62828',
  HIGH:     '#e65100',
  ELEVATED: '#f57f17',
  NORMAL:   '#2e7d32',
};

const RISK_LABELS = {
  CRITICAL: 'CRITICAL',
  HIGH:     'HIGH',
  ELEVATED: 'ELEVATED',
  NORMAL:   'NORMAL',
};

// ── HTML escape ───────────────────────────────────────────────────────────────

function _escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Top signal extraction ─────────────────────────────────────────────────────

/**
 * Extract the top N signals from the risk_cases.signals JSONB object,
 * sorted by score descending.
 *
 * signals structure: { SIGNAL_TYPE: { score: number, events: number }, ... }
 *
 * @param {object} signals
 * @param {number} limit
 * @returns {{ type: string, label: string, events: number }[]}
 */
function _getTopSignals(signals, limit = 2) {
  if (!signals || typeof signals !== 'object') return [];

  return Object.entries(signals)
    .map(([type, data]) => ({
      type,
      label:  SIGNAL_LABELS[type] || type,
      score:  typeof data.score  === 'number' ? data.score  : 0,
      events: typeof data.events === 'number' ? data.events : 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ── Email renderer ────────────────────────────────────────────────────────────

/**
 * renderEmail(caseData)
 *
 * Produces { subject, html, text } for a risk notification email.
 *
 * @param {{
 *   organizationName: string,
 *   userDisplayName:  string,
 *   userRoleLabel:    string,
 *   peakRiskLevel:    string,
 *   peakRiskScore:    number,
 *   signals:          object,
 *   openedAt:         string|Date,
 * }} caseData
 * @returns {{ subject: string, html: string, text: string }}
 */
function renderEmail(caseData) {
  const {
    organizationName,
    userDisplayName,
    userRoleLabel,
    peakRiskLevel,
    peakRiskScore,
    signals,
    openedAt,
  } = caseData;

  const levelColor = RISK_COLORS[peakRiskLevel] || RISK_COLORS.ELEVATED;
  const levelLabel = RISK_LABELS[peakRiskLevel] || peakRiskLevel;
  const topSignals = _getTopSignals(signals, 2);
  const openedDate = openedAt
    ? new Date(openedAt).toUTCString()
    : 'Unknown';

  const subject = `${levelLabel} Risk Activity — ${organizationName}`;

  // ── Signal rows (HTML) ─────────────────────────────────────────────────────

  const signalRowsHtml = topSignals.map(s => `
              <tr>
                <td style="padding:7px 0;font-size:13px;color:#444;border-bottom:1px solid #eeeeee;">
                  ${_escHtml(s.label)}
                </td>
                <td style="padding:7px 0;font-size:13px;color:#666;text-align:right;border-bottom:1px solid #eeeeee;">
                  ${s.events} event${s.events !== 1 ? 's' : ''}
                </td>
              </tr>`).join('');

  // ── HTML body ──────────────────────────────────────────────────────────────

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Security Risk Alert — ${_escHtml(organizationName)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background-color:#f4f6f8;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="580" cellpadding="0" cellspacing="0"
               style="background:#ffffff;border-radius:6px;overflow:hidden;
                      box-shadow:0 1px 6px rgba(0,0,0,0.10);">

          <!-- ── Header ─────────────────────────────────────────────────── -->
          <tr>
            <td style="background-color:${_escHtml(levelColor)};padding:24px 36px;">
              <p style="margin:0 0 4px;font-size:11px;color:rgba(255,255,255,0.75);
                        text-transform:uppercase;letter-spacing:0.8px;">
                Security Awareness Alert
              </p>
              <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;
                          line-height:1.3;">
                ${_escHtml(levelLabel)} Risk Activity Detected
              </h1>
            </td>
          </tr>

          <!-- ── Intro ──────────────────────────────────────────────────── -->
          <tr>
            <td style="padding:28px 36px 0;">
              <p style="margin:0;font-size:14px;color:#333333;line-height:1.6;">
                The SAMA-SUITE security system has detected elevated risk activity in
                <strong>${_escHtml(organizationName)}</strong>.
                Please log in to the Security Operations dashboard to review the
                case, acknowledge it, or close it with your findings.
              </p>
            </td>
          </tr>

          <!-- ── Case summary card ──────────────────────────────────────── -->
          <tr>
            <td style="padding:20px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f8f9fb;border:1px solid #e0e4ea;
                            border-radius:5px;padding:18px;">
                <!-- User + Role row -->
                <tr>
                  <td style="font-size:11px;color:#888;text-transform:uppercase;
                              letter-spacing:0.5px;padding-bottom:3px;">User</td>
                  <td style="font-size:11px;color:#888;text-transform:uppercase;
                              letter-spacing:0.5px;padding-bottom:3px;text-align:right;">
                    Role
                  </td>
                </tr>
                <tr>
                  <td style="font-size:16px;color:#1a1a2e;font-weight:700;
                              padding-bottom:14px;">
                    ${_escHtml(userDisplayName)}
                  </td>
                  <td style="font-size:15px;color:#444;text-align:right;
                              padding-bottom:14px;">
                    ${_escHtml(userRoleLabel || 'Unknown')}
                  </td>
                </tr>
                <!-- Divider -->
                <tr>
                  <td colspan="2"
                      style="border-top:1px solid #e0e4ea;padding-top:14px;">
                  </td>
                </tr>
                <!-- Risk level + Score row -->
                <tr>
                  <td style="font-size:11px;color:#888;text-transform:uppercase;
                              letter-spacing:0.5px;padding-bottom:3px;">Peak Risk Level</td>
                  <td style="font-size:11px;color:#888;text-transform:uppercase;
                              letter-spacing:0.5px;padding-bottom:3px;text-align:right;">
                    Risk Score
                  </td>
                </tr>
                <tr>
                  <td style="font-size:16px;font-weight:700;color:${_escHtml(levelColor)};
                              padding-bottom:14px;">
                    ${_escHtml(levelLabel)}
                  </td>
                  <td style="font-size:16px;color:#1a1a2e;text-align:right;
                              padding-bottom:14px;">
                    ${Number(peakRiskScore)}
                  </td>
                </tr>
                <!-- Divider -->
                <tr>
                  <td colspan="2"
                      style="border-top:1px solid #e0e4ea;padding-top:14px;">
                  </td>
                </tr>
                <!-- Case opened -->
                <tr>
                  <td colspan="2" style="font-size:11px;color:#888;
                                          text-transform:uppercase;letter-spacing:0.5px;
                                          padding-bottom:3px;">
                    Case Opened
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="font-size:14px;color:#444;">
                    ${_escHtml(openedDate)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Top signals ─────────────────────────────────────────────── -->
          ${topSignals.length ? `
          <tr>
            <td style="padding:0 36px 24px;">
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#666;
                        text-transform:uppercase;letter-spacing:0.6px;">
                Contributing Signals
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <th style="font-size:11px;color:#aaa;font-weight:400;
                              text-align:left;padding-bottom:4px;">Signal Type</th>
                  <th style="font-size:11px;color:#aaa;font-weight:400;
                              text-align:right;padding-bottom:4px;">Events</th>
                </tr>
                ${signalRowsHtml}
              </table>
            </td>
          </tr>` : ''}

          <!-- ── Call to action ──────────────────────────────────────────── -->
          <tr>
            <td style="padding:8px 36px 32px;">
              <p style="margin:0;font-size:13px;color:#555;line-height:1.6;
                        background:#fff9e6;border-left:3px solid ${_escHtml(levelColor)};
                        padding:12px 16px;border-radius:0 4px 4px 0;">
                Log in to the <strong>Security Operations</strong> dashboard to
                review this case and take appropriate action.
                Cases can be acknowledged to confirm awareness, or closed with
                your investigation findings.
              </p>
            </td>
          </tr>

          <!-- ── Footer ─────────────────────────────────────────────────── -->
          <tr>
            <td style="background:#f4f6f8;padding:16px 36px;
                        border-top:1px solid #e0e4ea;">
              <p style="margin:0;font-size:11px;color:#aaa;text-align:center;
                        line-height:1.6;">
                This is an automated awareness notification from
                <strong>Sama Technologies</strong>.<br>
                No action is required on this email. Do not reply to this message.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // ── Plain-text body ────────────────────────────────────────────────────────

  const signalTextLines = topSignals.length
    ? topSignals
        .map(s => `  • ${s.label} — ${s.events} event${s.events !== 1 ? 's' : ''}`)
        .join('\n')
    : '  No signal details available';

  const text = [
    `SECURITY AWARENESS ALERT — ${levelLabel} RISK ACTIVITY`,
    `Organization: ${organizationName}`,
    '',
    `User:            ${userDisplayName}`,
    `Role:            ${userRoleLabel || 'Unknown'}`,
    `Peak Risk Level: ${levelLabel}`,
    `Risk Score:      ${peakRiskScore}`,
    `Case Opened:     ${openedDate}`,
    '',
    'Contributing Signals:',
    signalTextLines,
    '',
    'Log in to the Security Operations dashboard to review this case,',
    'acknowledge it, or close it with your investigation findings.',
    '',
    '---',
    'This is an automated awareness notification from Sama Technologies.',
    'No action is required on this email. Do not reply.',
  ].join('\n');

  return { subject, html, text };
}

module.exports = { renderEmail };
