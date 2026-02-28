'use strict';

const { manualRetry } = require('./notificationRetryManual.service');

async function retryNotification(req, res) {
  const { organizationId } = req.user;
  const { logId }          = req.params;

  try {
    const result = await manualRetry({ organizationId, logId });
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    // 502 = send attempted but gateway rejected — still return structured response
    if (err.statusCode === 502) {
      return res.status(502).json({
        success:  false,
        message:  `Retry attempted but send failed: ${err.message}`,
        data: {
          retried:  true,
          success:  false,
          logId,
          attempts: err.attempts,
        },
      });
    }

    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }

    console.error('retryNotification error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { retryNotification };
