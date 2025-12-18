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
      console.log('   📋 Full parsed data:', JSON.stringify(parsedData, null, 2));

      const twiml = new twilio.twiml.MessagingResponse();

      if (parsedData.needs_reason) {
        console.log('   💬 Sending follow-up request for more details...');
        // Type is identified, but needs more details
        if (parsedData.type === 'sick') {
          twiml.message(`Hi ${employee.name}, got it. What's the specific reason? (e.g., flu, fever, doctor appt)`);
        } else if (parsedData.type === 'late') {
          if (parsedData.missing_minutes) {
            twiml.message(`Hi ${employee.name}, how many minutes late and why? (e.g., "30 min - traffic")`);
          } else {
            twiml.message(`Hi ${employee.name}, what's the reason you're late? (e.g., traffic, car trouble)`);
          }
        } else if (parsedData.type === 'personal') {
          twiml.message(`Hi ${employee.name}, what's the reason for personal day? (e.g., family emergency, appt)`);
        }
        console.log('   📤 Follow-up message prepared, sending TwiML response...');
      } else if (parsedData.needs_clarification) {
        console.log('   💬 Sending clarification request...');
        twiml.message(`Hi ${employee.name}, please clarify: Are you sick, running late (how many min?), or taking a personal day?`);
        console.log('   📤 Clarification message prepared, sending TwiML response...');
      } else {
        console.log('   💬 Sending generic help message...');
        twiml.message(`Hi ${employee.name}, please text: "Sick - [reason]", "30 min late - [reason]", or "Personal - [reason]"`);
        console.log('   📤 Generic help message prepared, sending TwiML response...');
      }

      const twimlString = twiml.toString();
      console.log('   📤 Final TwiML:', twimlString);
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
