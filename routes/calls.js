const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const WorkStation = require('../models/WorkStation');
const attendanceService = require('../services/attendanceService');
const vapiService = require('../services/vapiService');

// Twilio webhook for incoming calls
router.post('/incoming', async (req, res) => {
  try {
    const { From: callerNumber, CallSid } = req.body;

    console.log(`Incoming call from: ${callerNumber}, CallSid: ${CallSid}`);

    // Look up employee by phone
    const employee = await vapiService.getEmployeeByPhone(callerNumber);

    // Start Vapi conversation
    const vapiCall = await vapiService.startCall(callerNumber, employee);

    // Return TwiML to forward call to Vapi
    // In production, you would configure Twilio to forward to Vapi's number
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Welcome to Felton Brushes attendance system. Please wait while we connect your call.</Say>
  <Dial>${process.env.VAPI_PHONE_NUMBER}</Dial>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
  } catch (error) {
    console.error('Error handling incoming call:', error);

    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, there was an error processing your call. Please try again later or contact your supervisor directly.</Say>
  <Hangup/>
</Response>`;

    res.type('text/xml');
    res.send(errorTwiml);
  }
});

// Vapi function call handler (called during conversation)
router.post('/vapi-function', async (req, res) => {
  try {
    const { functionName, parameters } = req.body;

    console.log(`\n🔔 VAPI function call received:`);
    console.log(`   Function: ${functionName}`);
    console.log(`   Parameters:`, JSON.stringify(parameters, null, 2));

    // Execute the appropriate function from vapiService
    if (vapiService.vapiFunction[functionName]) {
      const result = await vapiService.vapiFunction[functionName](parameters);

      console.log(`   Result:`, JSON.stringify(result, null, 2));

      return res.json(result);
    }

    console.log(`   ❌ Function ${functionName} not found`);
    return res.status(404).json({
      success: false,
      error: `Function ${functionName} not found`
    });
  } catch (error) {
    console.error('❌ Error executing VAPI function:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Vapi webhook for completed calls
router.post('/vapi-webhook', async (req, res) => {
  try {
    const callData = req.body;

    console.log('Vapi webhook received:', JSON.stringify(callData, null, 2));

    // Extract data from Vapi webhook
    const {
      transcript,
      call,
      messages,
      artifact = {}
    } = callData;

    const functionCalls = artifact.functionCalls || callData.functionCalls || [];

    // Find the log_absence or log_tardy function call
    const absenceCall = functionCalls.find(fc => fc.name === 'log_absence');
    const tardyCall = functionCalls.find(fc => fc.name === 'log_tardy');

    if (!absenceCall && !tardyCall) {
      console.log('No absence or tardy logged in this call');
      return res.json({ success: true, message: 'Call completed, no absence logged' });
    }

    // Get employee_id from whichever function was called
    const employeeIdParam = absenceCall?.parameters?.employee_id || tardyCall?.parameters?.employee_id;

    if (!employeeIdParam) {
      console.log('No employee_id in function call parameters');
      return res.json({ success: true, message: 'Call completed, no employee identified' });
    }

    // Find employee
    const employee = await Employee.findOne({ employee_id: employeeIdParam });

    if (!employee) {
      console.error('Employee not found:', employeeIdParam);
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    // Find the most recent absence record for this employee (created during the call)
    const callStartTime = new Date(call?.startedAt || Date.now());
    const fiveMinutesAgo = new Date(callStartTime.getTime() - 5 * 60 * 1000);

    const existingAbsence = await Absence.findOne({
      employee_id: employee._id,
      call_time: { $gte: fiveMinutesAgo }
    }).sort({ call_time: -1 });

    if (existingAbsence) {
      // Update existing record with transcript and call details
      existingAbsence.call_transcript = transcript || null;
      existingAbsence.call_duration = call?.duration || existingAbsence.call_duration || 0;
      existingAbsence.call_recording_url = call?.recordingUrl || null;

      await existingAbsence.save();

      console.log(`✅ Updated absence record with transcript for ${employee.name}`);

      return res.json({
        success: true,
        message: 'Transcript saved',
        absence: existingAbsence
      });
    } else {
      console.log(`⚠️ No recent absence record found for ${employee.name} to update with transcript`);
      return res.json({
        success: true,
        message: 'No recent absence record found to update'
      });
    }
  } catch (error) {
    console.error('Error processing Vapi webhook:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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
