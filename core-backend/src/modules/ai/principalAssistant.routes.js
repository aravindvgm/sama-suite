'use strict';

const express           = require('express');
const multer            = require('multer');
const router            = express.Router();
const asyncHandler      = require('../../utils/asyncHandler');
const verifyToken       = require('../../middleware/auth.middleware');
const requirePermission = require('../../middleware/requirePermission');
const controller        = require('./principalAssistant.controller');
const actionController  = require('./assistantAction.controller');
const speechController         = require('./assistantSpeech.controller');
const speechResponseController = require('./assistantSpeechResponse.controller');

// ── Multer: memory storage, 25 MB limit (Whisper API max) ────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('audio/')) {
      const err = new Error('Only audio files are accepted');
      err.statusCode = 400;
      return cb(err, false);
    }
    cb(null, true);
  },
});

// Wraps multer so format/size errors return clean JSON instead of
// falling through to the global Express error handler.
function handleAudioUpload(req, res, next) {
  upload.single('audio')(req, res, (err) => {
    if (!err) return next();
    const status  = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.statusCode || 400);
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Audio file too large. Maximum size is 25 MB.'
      : err.message;
    return res.status(status).json({ success: false, message });
  });
}

router.use(verifyToken);

// POST /ai/assistant
router.post('/assistant', requirePermission('dashboard:read'), asyncHandler(controller.askAssistant));

// POST /ai/assistant/action
router.post('/assistant/action', requirePermission('notifications:send'), asyncHandler(actionController.runAction));

// POST /ai/assistant/speech
router.post('/assistant/speech', requirePermission('dashboard:read'), handleAudioUpload, asyncHandler(speechController.speechToAssistant));

// POST /ai/assistant/speech-response
router.post('/assistant/speech-response', requirePermission('dashboard:read'), asyncHandler(speechResponseController.speechResponseToAssistant));

module.exports = router;
