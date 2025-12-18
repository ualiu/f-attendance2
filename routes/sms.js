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

    // Parse the SMS message using Claude LLM
    const parsedData = await smsService.parseAttendanceMessage(messageBody, employee);

    console.log('   📋 Parsed data:', parsedData);

    if (!parsedData.success) {
      console.log('   ❌ Failed to parse message:', parsedData.error);

      const twiml = new twilio.twiml.MessagingResponse();

      if (parsedData.needs_reason) {
        // Type is identified, but needs more details
        if (parsedData.type === 'sick') {
          twiml.message(`Hi ${employee.name}, got it - you can't come in due to illness.

What's the specific reason?

Examples:
• "Flu"
• "Fever and headache"
• "Stomach bug"
• "Doctor appointment"
• "COVID symptoms"

Please reply with the specific reason.`);
        } else if (parsedData.type === 'late') {
          if (parsedData.missing_minutes) {
            twiml.message(`Hi ${employee.name}, got it - you're running late.

How many minutes late AND what's the reason?

Examples:
• "30 min - traffic"
• "15 minutes - car trouble"
• "20 min - overslept"
• "1 hour - bus delayed"

Please reply with minutes and reason.`);
          } else {
            twiml.message(`Hi ${employee.name}, got it - you're running late.

What's the specific reason?

Examples:
• "Traffic jam"
• "Car won't start"
• "Overslept"
• "Train delayed"

Please reply with the reason.`);
          }
        } else if (parsedData.type === 'personal') {
          twiml.message(`Hi ${employee.name}, got it - you need a personal day.

What's the specific reason?

Examples:
• "Family emergency"
• "Child care issue"
• "Court appearance"
• "Car in shop"
• "Appointment"

Please reply with the reason.`);
        }
      } else if (parsedData.needs_clarification) {
        twiml.message(`Hi ${employee.name}, I need more info about your absence.

Please choose one and provide details:

🤒 SICK
Reply: "Sick - [reason]"
Example: "Sick - flu"

⏰ LATE
Reply: "Late - [minutes] - [reason]"
Example: "Late - 30 min - traffic"

📅 PERSONAL DAY
Reply: "Personal - [reason]"
Example: "Personal - family emergency"

Please reply with one of the formats above.`);
      } else {
        twiml.message(`Hi ${employee.name}, I couldn't understand your message.

Please use one of these formats:

🤒 SICK: "Sick - flu" or "Not feeling well - fever"

⏰ LATE: "30 min late - traffic" or "Running late - 15 min - overslept"

📅 PERSONAL: "Personal day - appointment" or "Family emergency"

Reply with more details so I can log your absence correctly.`);
      }

      res.type('text/xml');
      return res.send(twiml.toString());
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
