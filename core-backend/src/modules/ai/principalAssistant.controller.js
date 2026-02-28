'use strict';

const { answerQuestion }     = require('./principalAssistant.service');
const { insertConversation } = require('./assistantConversation.service');

async function askAssistant(req, res) {
  const { organizationId, id: userId } = req.user;
  const { question }                   = req.body;

  try {
    const data = await answerQuestion({ organizationId, userId, question });

    // Persist history fire-and-forget — must not block or alter the response
    insertConversation({
      organizationId,
      userId:   userId || null,
      question: data.question,
      answer:   data.answer,
      intent:   data.intent,
    }).catch(() => {});

    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('askAssistant error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { askAssistant };
