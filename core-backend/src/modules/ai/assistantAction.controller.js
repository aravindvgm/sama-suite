'use strict';

const { executeAction } = require('./assistantAction.service');

async function runAction(req, res) {
  const { organizationId } = req.user;
  const { actionType, payload } = req.body;

  try {
    const result = await executeAction({ organizationId, actionType, payload });
    return res.status(202).json({ success: true, data: result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('runAction error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { runAction };
