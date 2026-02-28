'use strict';

const { getConversationHistory } = require('./assistantConversation.service');

async function getHistory(req, res) {
  const { organizationId } = req.user;

  try {
    const conversations = await getConversationHistory({ organizationId });
    return res.status(200).json({ success: true, data: conversations });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getHistory error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getHistory };
