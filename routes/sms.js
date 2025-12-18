const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const smsService = require('../services/smsService');

// Twilio webhook for incoming SMS
router.post('/incoming', async (req, res) => {
  try {
    console.log('\n📱 SMS RECEIVED:');
    console.log('   From:', req.body.From);
    console.log('   Body:', req.body.Body);

    const { From: phoneNumber, Body: messageBody } = req.body;

    // Look up employee by phone number
    // Normalize: remove all non-digits
    const normalizedPhone = phoneNumber.replace(/\D/g, '');
    console.log('   Original phone:', phoneNumber);
    console.log('   Normalized phone:', normalizedPhone);

    // Try to find employee - search for the last 10 digits
    const last10Digits = normalizedPhone.slice(-10);
    console.log('   Searching for last 10 digits:', last10Digits);

    const employee = await Employee.findOne({
      phone: { $regex: last10Digits }
    });

    console.log('   Employee search result:', employee ? `Found: ${employee.name}` : 'Not found');

    if (!employee) {
      console.log('   ❌ Employee not found for phone:', phoneNumber);

      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message('Sorry, we couldn\'t find your employee record. Please contact your supervisor at (905) 522-3811 ext #8.');

      res.type('text/xml');
      return res.send(twiml.toString());
    }

    console.log('   ✅ Employee found:', employee.name);

    // Check if this is a follow-up message (conversation already active)
    const isFollowUp = smsService.isFollowUpMessage(phoneNumber);
    console.log('   🔄 Is follow-up message:', isFollowUp);

    // Mark this conversation as active
    smsService.markConversationActive(phoneNumber);

    // Parse the SMS message using Claude LLM
    const parsedData = await smsService.parseAttendanceMessage(messageBody, employee);

    console.log('   📋 Parsed data:', parsedData);

    if (!parsedData.success) {
      console.log('   ❌ Failed to parse message:', parsedData.error);
      console.log('   📋 Full parsed data:', JSON.stringify(parsedData, null, 2));

      const twiml = new twilio.twiml.MessagingResponse();
      let followUpMessage = '';

      // Only greet on first message, not on follow-ups
      const greeting = isFollowUp ? '' : `Hi ${employee.name}, `;

      // Determine what to ask based on what's missing
      if (parsedData.ask_what === 'status') {
        // Completely unclear - ask what's happening
        console.log('   💬 Asking for status (sick/late/out)...');
        followUpMessage = `${greeting}are you running late, calling out sick, or taking time off today?`;
      }
      else if (parsedData.ask_what === 'duration') {
        // We know the type but not duration
        console.log('   💬 Asking for duration...');

        if (parsedData.type === 'late' || parsedData.type === 'unclear_duration') {
          followUpMessage = `${greeting}how late will you be? (e.g., "30 min", "2 hours")`;
        } else {
          followUpMessage = `${greeting}how long will you be out? (e.g., "few hours", "half day", "all day")`;
        }
      }
      else if (parsedData.ask_what === 'reason') {
        // We know duration/type but not reason
        console.log('   💬 Asking for reason...');

        if (parsedData.type === 'late') {
          followUpMessage = `${greeting}why are you running late? (e.g., traffic, car trouble, appointment)`;
        } else if (parsedData.type === 'half_day' || parsedData.type === 'full_day') {
          if (parsedData.subtype === 'sick') {
            followUpMessage = `${greeting}what's going on? (e.g., flu, headache, doctor visit)`;
          } else {
            followUpMessage = `${greeting}what's the reason? (e.g., appointment, errands, family matter)`;
          }
        } else {
          followUpMessage = `${greeting}what's the reason?`;
        }
      }
      else {
        // Fallback - generic help
        console.log('   💬 Sending generic help message...');
        followUpMessage = `${greeting}please text something like: "Running 30 min late - traffic" or "Sick with flu" or "Out for appointment"`;
      }

      twiml.message(followUpMessage);
      console.log('   📤 Follow-up message:', followUpMessage);

      const twimlString = twiml.toString();
      res.type('text/xml');
      return res.send(twimlString);
    }

    // Create absence record
    const absence = await smsService.logAbsenceFromSMS({
      employee,
      parsedData,
      originalMessage: messageBody,
      phoneNumber
    });

    console.log('   ✅ Absence logged:', absence._id);

    // Generate response message
    const responseMessage = await smsService.generateResponseMessage(employee, absence, parsedData);

    console.log('   📤 Sending response:', responseMessage);

    // Send Twilio response
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(responseMessage);

    res.type('text/xml');
    res.send(twiml.toString());

  } catch (error) {
    console.error('❌ Error processing SMS:', error);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Sorry, there was an error processing your message. Please call (905) 522-3811 ext #8.');

    res.type('text/xml');
    res.send(twiml.toString());
  }
});

module.exports = router;
