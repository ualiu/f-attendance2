const express = require('express');
const router = express.Router();
const Absence = require('../models/Absence');

// Get call recording
router.get('/:id/recording', async (req, res) => {
  try {
    const absence = await Absence.findById(req.params.id);

    if (!absence || !absence.call_recording_url) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }

    // Redirect to recording URL (stored in Twilio/Vapi)
    res.redirect(absence.call_recording_url);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent calls
router.get('/', async (req, res) => {
  try {
    const { limit = 20, employee_id } = req.query;

    const query = {};
    if (employee_id) {
      query.employee_id = employee_id;
    }

    const calls = await Absence.find(query)
      .populate('employee_id')
      .sort({ call_time: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, calls });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific absence/call by ID
router.get('/:id', async (req, res) => {
  try {
    const absence = await Absence.findById(req.params.id).populate('employee_id');

    if (!absence) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    res.json({ success: true, absence });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
