const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const Organization = require('../models/Organization');
const smsService = require('../services/smsService');
const coverageService = require('../services/coverageService');

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

    // ── Shift coverage: manager approval reply ──────────────────────────────
    // Checked BEFORE the employee lookup: the manager is a Supervisor, whose
    // phone could coincidentally collide with an employee's. A pending
    // manager-approval reply is unambiguous and must never fall into the
    // absence flow below.
    try {
      const mgrOffer = await coverageService.findOfferAwaitingManager(last10Digits);
      if (mgrOffer) {
        console.log('   📌 Manager approval reply for offer', String(mgrOffer._id));
        const mgrOrg = await Organization.findById(mgrOffer.organization_id);
        const mgrProvider = mgrOrg?.settings?.llm_provider || 'claude';
        const { reply } = await coverageService.handleManagerReply({
          offer: mgrOffer, messageBody, provider: mgrProvider
        });
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(reply);
        res.type('text/xml');
        return res.send(twiml.toString());
      }
    } catch (err) {
      console.error('❌ Error in coverage manager-reply routing (falling through to normal flow):', err);
    }

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

    // ── Shift coverage: candidate offer reply ───────────────────────────────
    // Skipped while an absence conversation has a pending question - that
    // "yes" is answering OUR question (e.g. "is this a sick day or a
    // personal day?"), not an offer. See coverageService.js handleCandidateReply.
    try {
      const midQuestion = conversationState
        && conversationState.status === 'collecting'
        && conversationState.last_question_asked;

      if (!midQuestion) {
        const candOffer = await coverageService.findOfferForCandidatePhone(last10Digits);
        if (candOffer) {
          console.log('   📌 Candidate offer reply for offer', String(candOffer._id));
          const { handled, reply } = await coverageService.handleCandidateReply({
            offer: candOffer, phoneLast10: last10Digits, messageBody, provider: llmProvider
          });
          if (handled) {
            const twiml = new twilio.twiml.MessagingResponse();
            twiml.message(reply);
            res.type('text/xml');
            return res.send(twiml.toString());
          }
          console.log('   🆕 Reply looked like an absence report - falling through to absence flow');
        }
      }
    } catch (err) {
      console.error('❌ Error in coverage candidate-reply routing (falling through to normal flow):', err);
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
        // Fire-and-forget: a corrected/undone absence no longer needs coverage.
        // Never let a coverage-side failure affect the correction itself.
        coverageService.cancelOfferForAbsence(priorLoggedAbsenceId, 'absence_corrected')
          .catch(err => console.error('❌ Coverage offer cancel failed (absence still corrected):', err));
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

    // Shift coverage: only for full-day call-ins (lates and short/half-day
    // absences are unaffected, per design - "we don't care about lates").
    // Fire-and-forget: coverage must never delay or break the SMS confirmation,
    // and a coverage failure must never un-log an absence that was already
    // successfully recorded.
    if (parsedData.type === 'full_day') {
      coverageService.startCoverage({ absence, employee, organization, trigger: 'sms_auto' })
        .catch(err => console.error('❌ Coverage start failed (absence still logged):', err));
    }

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
