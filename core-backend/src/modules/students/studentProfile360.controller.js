'use strict';

const { getStudentProfile360 } = require('./studentProfile360.service');

async function getStudentProfile(req, res) {
  const { organizationId } = req.user;
  const { studentId }      = req.params;

  try {
    const data = await getStudentProfile360({ organizationId, studentId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    console.error('getStudentProfile error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { getStudentProfile };
