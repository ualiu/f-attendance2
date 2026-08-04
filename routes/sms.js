const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const Organization = require('../models/Organization');
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

    // Load organization
    const organization = await Organization.findById(employee.organization_id);
    const organizationName = organization ? organization.name : 'your company';

    const llmProvider = organization?.settings?.llm_provider || 'claude';
    console.log(`   🤖 Using ${llmProvider.toUpperCase()} for SMS parsing`);

    // Get organization timezone and current time
    const orgTimezone = organization?.settings?.timezone || 'America/New_York';
    const now = new Date();
    const currentTimeInTZ = now.toLocaleString('en-US', {
      timeZone: orgTimezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    console.log(`   🕐 Current time in ${orgTimezone}: ${currentTimeInTZ}`);

    // Get conversation state (if this is a follow-up)
    let conversationState = await smsService.getConversationState(phoneNumber);
    const isFollowUp = conversationState !== null;
    console.log('   🔄 Is follow-up message:', isFollowUp);
    if (conversationState) {
      console.log('   💬 Conversation state:', JSON.stringify(conversationState.collected_info, null, 2));
    }

    // If we already logged an absence in this window, this message may be the
    // employee correcting it (we invited them to). Remember which record so we
    // can undo it if so.
    const priorLoggedAbsenceId =
      conversationState?.status === 'logged' ? conversationState.last_absence_id : null;
    if (priorLoggedAbsenceId) {
      console.log('   📌 Within correction window for absence', String(priorLoggedAbsenceId));
    }

    // Initialize transcript array if this is a new conversation
    if (!conversationState || !conversationState.transcript) {
      if (!conversationState) {
        conversationState = { transcript: [] };
      } else {
        conversationState.transcript = [];
      }
    }

    // Add employee message to transcript
    conversationState.transcript.push({
      from: 'employee',
      message: messageBody,
      timestamp: new Date()
    });
    console.log('   📝 Added employee message to transcript. Transcript length:', conversationState.transcript.length);
    console.log('   📝 Transcript contents:', JSON.stringify(conversationState.transcript, null, 2));

    // Add current message to conversation state (before parsing) - pass transcript to preserve it
    conversationState = await smsService.updateConversationState(phoneNumber, messageBody, null, null, conversationState.transcript);
    console.log('   📝 After updateConversationState. Transcript length:', conversationState.transcript.length);

    // Parse the SMS message using LLM with conversation context and timezone
    const parsedData = await smsService.parseAttendanceMessage(messageBody, employee, organizationName, conversationState, {
      timezone: orgTimezone,
      currentTime: currentTimeInTZ
    }, llmProvider);

    console.log('   📋 Parsed data:', parsedData);

    // Post-log handling. Either the employee is correcting the record we just
    // created, or they have moved on to an unrelated new report.
    if (priorLoggedAbsenceId) {
      if (parsedData.is_correction) {
        await smsService.undoLoggedAbsence(priorLoggedAbsenceId, employee._id);
        conversationState = await smsService.reopenConversationForCorrection(phoneNumber);
      } else {
        console.log('   🆕 Not a correction - starting a fresh conversation');
        await smsService.clearConversation(phoneNumber);
        conversationState = await smsService.updateConversationState(
          phoneNumber, messageBody, null, null,
          [{ from: 'employee', message: messageBody, timestamp: new Date() }]
        );
      }
    }

    if (!parsedData.success) {
      console.log('   ❌ Failed to parse message:', parsedData.error);
      console.log('   📋 Full parsed data:', JSON.stringify(parsedData, null, 2));

      const twiml = new twilio.twiml.MessagingResponse();

      // Wording lives in smsService so the test harness exercises it too
      const { questionAsked, message: baseQuestion } =
        smsService.buildFollowUpQuestion(parsedData, employee, isFollowUp);
      let followUpMessage = baseQuestion;
      console.log(`   💬 Asking for ${questionAsked}...`);

      // Loop breaker: if we're about to ask the same thing again, acknowledge it,
      // and after several turns hand off to a human instead of looping forever.
      const repeatingQuestion = conversationState.last_question_asked === questionAsked;
      const turnCount = conversationState.messages?.length || 0;

      if (repeatingQuestion && turnCount >= 4) {
        console.log('   🛑 Loop detected - handing off to phone');
        followUpMessage = `Sorry, I'm having trouble understanding. Please call (905) 522-3811 ext #8 and we'll log it for you.`;
      } else if (repeatingQuestion) {
        console.log('   ⚠️  Re-asking the same question');
        followUpMessage = `Sorry, I didn't catch that. ${followUpMessage}`;
      }

      // Add system response to transcript
      conversationState.transcript.push({
        from: 'system',
        message: followUpMessage,
        timestamp: new Date()
      });

      // Update conversation state with parsed data, question asked, and transcript
      conversationState = await smsService.updateConversationState(phoneNumber, null, parsedData, questionAsked, conversationState.transcript);

      twiml.message(followUpMessage);
      console.log('   📤 Follow-up message:', followUpMessage);

      const twimlString = twiml.toString();
      res.type('text/xml');
      return res.send(twimlString);
    }

    // Add final system response to transcript before saving
    const responseMessage = await smsService.generateResponseMessage(employee, null, parsedData);
    conversationState.transcript.push({
      from: 'system',
      message: responseMessage,
      timestamp: new Date()
    });
    console.log('   📝 Before saving absence. Transcript length:', conversationState.transcript.length);
    console.log('   📝 Full transcript:', JSON.stringify(conversationState.transcript, null, 2));

    // Create absence record with full conversation transcript
    const absence = await smsService.logAbsenceFromSMS({
      employee,
      parsedData,
      originalMessage: messageBody,
      phoneNumber,
      transcript: conversationState.transcript,
      organization
    });

    console.log('   ✅ Absence logged:', absence._id);

    // Keep the conversation alive instead of clearing it, so the employee can
    // reply to correct the record (the confirmation invites them to). It still
    // expires on the normal 15-minute TTL.
    const loggedSummary =
      `${parsedData.type} (${parsedData.subtype || 'n/a'}), ` +
      `${parsedData.duration_minutes || 0} min, ` +
      `${parsedData.date || 'today'}, reason: ${parsedData.reason || 'none'}`;
    await smsService.markConversationLogged(phoneNumber, absence, loggedSummary);
    console.log('   📌 Correction window open:', loggedSummary);

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
