'use strict';

const { launchCampaign } = require('../notifications/campaign.service');

// ============================================================
// SUPPORTED ACTION TYPES
// Only actions that require backend execution are handled here.
// Client-side navigation actions (VIEW_REPORT, VIEW_STUDENT_PROFILE)
// are intentionally excluded — they carry no server-side work.
// ============================================================

const SUPPORTED_ACTION_TYPES = ['LAUNCH_CAMPAIGN'];

// ============================================================
// DEFAULT MESSAGES
//
// The AI assistant surfaces action buttons without a composed
// message — we generate a sensible default per campaign type.
// Callers may override by providing payload.message.
// CLASS_BROADCAST has no default because the message is
// class-specific; it must be supplied in the payload.
// ============================================================

const DEFAULT_CAMPAIGN_MESSAGE = {
  OVERDUE_FEES:
    'Dear Parent, this is a reminder that your ward has outstanding fees. ' +
    'Please clear the dues at the earliest to avoid any inconvenience. Thank you.',
  LOW_ATTENDANCE:
    "Dear Parent, your ward's attendance has fallen below the required 75% threshold. " +
    'Please ensure regular attendance. Contact the school office if you need support.',
  FESTIVAL_GREETING:
    'Wishing you and your family a joyous celebration! ' +
    'Thank you for being a valued part of our school community.',
  CLASS_BROADCAST: null, // caller must supply message
};

// ============================================================
// ACTION EXECUTORS
// ============================================================

async function executeLaunchCampaign(organizationId, payload) {
  const { campaignType, message, classId } = payload || {};

  // Resolve message: explicit payload wins, then default, then fail.
  const resolvedMessage =
    (message && message.trim()) ||
    DEFAULT_CAMPAIGN_MESSAGE[campaignType] ||
    null;

  if (!resolvedMessage) {
    const err = new Error(
      `payload.message is required for campaignType "${campaignType}" — no default message is defined.`
    );
    err.statusCode = 422;
    throw err;
  }

  return launchCampaign({
    organizationId,
    campaignType,
    message: resolvedMessage,
    classId: classId || null,
  });
}

// ============================================================
// MAIN
// ============================================================

async function executeAction({ organizationId, actionType, payload }) {
  if (!actionType) {
    const err = new Error('actionType is required');
    err.statusCode = 422;
    throw err;
  }

  switch (actionType) {
    case 'LAUNCH_CAMPAIGN':
      return executeLaunchCampaign(organizationId, payload);

    default: {
      const err = new Error(
        `Unsupported actionType: "${actionType}". Supported: ${SUPPORTED_ACTION_TYPES.join(', ')}`
      );
      err.statusCode = 422;
      throw err;
    }
  }
}

module.exports = { executeAction };
