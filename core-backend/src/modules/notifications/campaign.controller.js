'use strict';

const { launchCampaign } = require('./campaign.service');

async function sendCampaign(req, res) {
  const { organizationId }                                    = req.user;
  const { campaignType, message, classId, confirmationToken } = req.body;

  try {
    const result = await launchCampaign({
      organizationId,
      campaignType,
      message,
      classId:           classId           || null,
      confirmationToken: confirmationToken || null,
    });

    // Batch exceeded thresholds — client must resend with CONFIRM_SEND token
    if (result.confirmationRequired) {
      return res.status(202).json({
        success:              true,
        confirmationRequired: true,
        message:              result.hint,
        data:                 result,
      });
    }

    return res.status(202).json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { sendCampaign };
