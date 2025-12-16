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

    console.log(`VAPI function call: ${functionName}`, parameters);

    // Execute the appropriate function from vapiService
    if (vapiService.vapiFunction[functionName]) {
      const result = await vapiService.vapiFunction[functionName](parameters);
      return res.json(result);
    }

    return res.status(404).json({
      success: false,
      error: `Function ${functionName} not found`
    });
  } catch (error) {
    console.error('Error executing VAPI function:', error);
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
      functionCalls = []
    } = callData;

    // Find the log_absence or log_tardy function call
    const absenceCall = functionCalls.find(fc => fc.name === 'log_absence');
    const tardyCall = functionCalls.find(fc => fc.name === 'log_tardy');

    if (!absenceCall && !tardyCall) {
      console.log('No absence or tardy logged in this call');
      return res.json({ success: true, message: 'Call completed, no absence logged' });
    }

    // Process absence
    if (absenceCall) {
      const { employee_id, type, reason, expected_return, work_station } = absenceCall.parameters;

      // Find employee
      const employee = await Employee.findOne({ employee_id });

      if (!employee) {
        console.error('Employee not found:', employee_id);
        return res.status(404).json({ success: false, error: 'Employee not found' });
      }

      // Calculate points
      const pointsAwarded = attendanceService.calculatePointsToAward(type);

      // Check notice time
      const callTime = new Date(call?.startedAt || Date.now());
      const noticeCheck = attendanceService.checkNoticeTime(employee, callTime);

      // Check station impact
      const stationImpact = await attendanceService.checkStationImpact(work_station || employee.work_station);

      // Create absence record
      const absence = await Absence.create({
        employee_id: employee._id,
        employee_name: employee.name,
        work_station: work_station || employee.work_station,
        date: new Date(),
        type,
        reason,
        expected_return: expected_return ? new Date(expected_return) : null,
        call_time: callTime,
        call_duration: call?.duration || 0,
        call_recording_url: call?.recordingUrl || null,
        call_transcript: transcript || null,
        points_awarded: pointsAwarded,
        late_notice: noticeCheck.isLateNotice,
        station_impacted: stationImpact.impacted
      });

      // Update employee stats
      await attendanceService.updateEmployeeStats(employee._id);

      console.log(`Absence logged for ${employee.name}: ${type} - ${reason}`);

      res.json({
        success: true,
        absence,
        employee: await Employee.findById(employee._id)
      });
    }

    // Process tardy
    if (tardyCall) {
      const { employee_id, minutes_late, reason } = tardyCall.parameters;

      const employee = await Employee.findOne({ employee_id });

      if (!employee) {
        return res.status(404).json({ success: false, error: 'Employee not found' });
      }

      const callTime = new Date(call?.startedAt || Date.now());
      const noticeCheck = attendanceService.checkNoticeTime(employee, callTime);

      const absence = await Absence.create({
        employee_id: employee._id,
        employee_name: employee.name,
        work_station: employee.work_station,
        date: new Date(),
        type: 'late',
        reason: `${minutes_late} minutes late - ${reason}`,
        call_time: callTime,
        call_duration: call?.duration || 0,
        call_recording_url: call?.recordingUrl || null,
        call_transcript: transcript || null,
        points_awarded: 0.33,
        late_notice: noticeCheck.isLateNotice
      });

      await attendanceService.updateEmployeeStats(employee._id);

      console.log(`Tardy logged for ${employee.name}: ${minutes_late} minutes late`);

      res.json({
        success: true,
        absence,
        employee: await Employee.findById(employee._id)
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

module.exports = router;
