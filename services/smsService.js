const Anthropic = require('@anthropic-ai/sdk');
const Absence = require('../models/Absence');
const attendanceService = require('./attendanceService');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Track recent conversations with full state
// Key: phone number, Value: { timestamp, messages, collectedInfo }
const recentConversations = new Map();

// Check if this is a continuation of a recent conversation (within 10 minutes)
exports.isFollowUpMessage = (phoneNumber) => {
  const conversation = recentConversations.get(phoneNumber);
  if (!conversation) return false;

  const tenMinutesAgo = Date.now() - (10 * 60 * 1000); // 10 minutes
  const isFollowUp = conversation.timestamp > tenMinutesAgo;

  return isFollowUp;
};

// Get conversation state
exports.getConversationState = (phoneNumber) => {
  const conversation = recentConversations.get(phoneNumber);
  if (!conversation) return null;

  const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
  if (conversation.timestamp < tenMinutesAgo) {
    // Conversation expired
    recentConversations.delete(phoneNumber);
    return null;
  }

  return conversation;
};

// Update conversation state
exports.updateConversationState = (phoneNumber, messageBody, parsedData, questionAsked = null) => {
  const existing = recentConversations.get(phoneNumber) || {
    messages: [],
    collectedInfo: {}
  };

  existing.timestamp = Date.now();
  existing.messages.push({
    text: messageBody,
    timestamp: Date.now()
  });

  // Update collected info
  if (parsedData) {
    if (parsedData.type && !existing.collectedInfo.type) {
      existing.collectedInfo.type = parsedData.type;
    }
    if (parsedData.subtype && !existing.collectedInfo.subtype) {
      existing.collectedInfo.subtype = parsedData.subtype;
    }
    if (parsedData.reason && !existing.collectedInfo.reason) {
      existing.collectedInfo.reason = parsedData.reason;
    }
    if (parsedData.duration_minutes && !existing.collectedInfo.duration_minutes) {
      existing.collectedInfo.duration_minutes = parsedData.duration_minutes;
    }
  }

  if (questionAsked) {
    existing.lastQuestionAsked = questionAsked;
  }

  recentConversations.set(phoneNumber, existing);

  // Clean up old entries (over 15 minutes old)
  const fifteenMinutesAgo = Date.now() - (15 * 60 * 1000);
  for (const [phone, conv] of recentConversations.entries()) {
    if (conv.timestamp < fifteenMinutesAgo) {
      recentConversations.delete(phone);
    }
  }

  return existing;
};

// Clear conversation (when successfully logged)
exports.clearConversation = (phoneNumber) => {
  recentConversations.delete(phoneNumber);
};

// Legacy function for backward compatibility
exports.markConversationActive = (phoneNumber) => {
  exports.updateConversationState(phoneNumber, null, null);
};

// Parse attendance message using Claude
exports.parseAttendanceMessage = async (messageBody, employee, organizationName = 'your company', conversationState = null) => {
  try {
    // Build conversation context if this is a follow-up
    let conversationContext = '';
    if (conversationState && conversationState.messages && conversationState.messages.length > 1) {
      conversationContext = '\n\n═══════════════════════════════════════════════════════════════════\n';
      conversationContext += 'CONVERSATION HISTORY (This is a follow-up message)\n';
      conversationContext += '═══════════════════════════════════════════════════════════════════\n\n';
      conversationContext += 'Previous messages in this conversation:\n';

      // Show previous messages (excluding the current one we're parsing)
      const previousMessages = conversationState.messages.slice(0, -1);
      previousMessages.forEach((msg, idx) => {
        conversationContext += `${idx + 1}. "${msg.text}"\n`;
      });

      // Show what we've collected so far
      if (conversationState.collectedInfo && Object.keys(conversationState.collectedInfo).length > 0) {
        conversationContext += '\nINFO ALREADY COLLECTED:\n';
        if (conversationState.collectedInfo.type) {
          conversationContext += `- Type: ${conversationState.collectedInfo.type}\n`;
        }
        if (conversationState.collectedInfo.subtype) {
          conversationContext += `- Subtype: ${conversationState.collectedInfo.subtype}\n`;
        }
        if (conversationState.collectedInfo.reason) {
          conversationContext += `- Reason: ${conversationState.collectedInfo.reason}\n`;
        }
        if (conversationState.collectedInfo.duration_minutes) {
          conversationContext += `- Duration: ${conversationState.collectedInfo.duration_minutes} minutes\n`;
        }
      }

      // Show what question was asked
      if (conversationState.lastQuestionAsked) {
        conversationContext += `\nLAST QUESTION WE ASKED: ${conversationState.lastQuestionAsked}\n`;
      }

      conversationContext += '\n🚨 CRITICAL INSTRUCTIONS FOR FOLLOW-UP MESSAGES:\n';
      conversationContext += '1. If the current message is JUST a duration (e.g., "1 hour", "30 min"), extract it as duration_minutes\n';
      conversationContext += '2. If the current message is JUST a reason (e.g., "groceries", "traffic"), extract it as reason\n';
      conversationContext += '3. Use the INFO ALREADY COLLECTED above - don\'t ask for it again!\n';
      conversationContext += '4. If we already have BOTH duration and reason, set missing_duration=false and missing_reason=false\n';
      conversationContext += '5. NEVER ask the same question twice - check conversation history first!\n';
      conversationContext += '═══════════════════════════════════════════════════════════════════\n';
    }

    const prompt = `You are an attendance assistant for ${organizationName}. Parse employee messages naturally and extract key information. Be EXTREMELY flexible and forgiving - employees text quickly and informally.

Employee: ${employee.name}
Shift: ${employee.shift}
Started: ${employee.start_date ? new Date(employee.start_date).toLocaleDateString() : 'Unknown'}
${conversationContext}
MESSAGE TO PARSE:
"${messageBody}"

═══════════════════════════════════════════════════════════════════
CRITICAL: BE EXTREMELY FLEXIBLE AND FORGIVING
═══════════════════════════════════════════════════════════════════

Accept ALL of these variations:
✅ Typos: "sicl", "trafic", "laye", "feaver"
✅ All caps: "RUNNING LATE", "SICK"
✅ Text speak: "cant", "gonna", "b late", "2hrs", "tmrw", "rn"
✅ No punctuation: "running late traffic"
✅ Informal: "gotta", "wanna", "lemme", "kinda"
✅ Misspellings: Accept any reasonable misspelling
✅ Emojis: "😷 sick", "🤒", "🚗 broke down"
✅ Questions: "can I come in late?", "is it ok if..."
✅ Apologies: "sorry", "my bad", "apologize"
✅ Past/future tense: "was sick", "will be late", "going to be out"
✅ Abbreviations: "dr appt", "emerg", "appt", "min", "hr"
✅ Multiple sentences: "Traffic is bad. Gonna be late. Sorry."
✅ Compound: "running late 30 min traffic bad"

═══════════════════════════════════════════════════════════════════
UNDERSTANDING DURATION & CLASSIFICATION
═══════════════════════════════════════════════════════════════════

Extract duration from MANY formats:

**Exact times:**
• "30 minutes" / "30 min" / "30min" / "30 mins" / "30m" → 30 minutes
• "half hour" / "1/2 hour" / ".5 hour" → 30 minutes
• "1 hour" / "an hour" / "1hr" / "1h" / "60 min" → 60 minutes
• "2 hours" / "2hrs" / "2h" / "couple hours" → 120 minutes
• "3 hours" / "3hrs" / "3h" / "180 min" / "few hours" → 180 minutes
• "4 hours" / "4hrs" / "4h" / "half day" → 240 minutes

**Text numbers:**
• "thirty minutes" / "thirty min" → 30 minutes
• "one hour" / "an hour" → 60 minutes
• "two hours" / "a couple hours" → 120 minutes

**Ranges (use midpoint):**
• "30-45 min" → 37 minutes
• "1-2 hours" → 90 minutes
• "2-3 hours" → 150 minutes

**Relative/Vague (estimate):**
• "soon" / "shortly" / "bit late" / "few min" → 15 minutes
• "a while" / "bit" → 30 minutes
• "long time" → 60 minutes

**Time of arrival (calculate from now):**
• "be there at 8:30" → Calculate delay from shift start
• "in 30" / "in thirty" / "30 from now" → 30 minutes

**Implied full day:**
• "today" / "all day" / "not coming in" / "taking the day" → 480 minutes
• "sick" (without duration) → 480 minutes (full day)
• "can't make it" (without duration) → 480 minutes

DURATION-BASED CLASSIFICATION:
• **< 2 hours (< 120 min)** → LATE (tardiness, coming in late)
• **2-4 hours (120-240 min)** → HALF_DAY (extended absence)
• **4+ hours (240+ min)** or "not coming in" → FULL_DAY

═══════════════════════════════════════════════════════════════════
COMPREHENSIVE SCENARIO DETECTION
═══════════════════════════════════════════════════════════════════

**LATE** (coming to work, just delayed < 2 hours):

Traffic/Transportation:
• "traffic" / "stuck" / "highway" / "gridlock" / "accident on road"
• "train delayed" / "bus late" / "missed bus" / "transit"
• "car trouble" / "car won't start" / "flat tire" / "battery dead"
• "no gas" / "out of gas" / "need gas"

Personal delays:
• "overslept" / "slept in" / "alarm didn't go off" / "slept through alarm"
• "running behind" / "running late" / "delayed"
• "taking too long" / "not ready" / "still getting ready"

Already on way:
• "be there soon" / "on my way" / "almost there" / "5 min away"
• "leaving now" / "just left" / "headed in" / "en route"

Any duration < 2 hours = LATE

**HALF_DAY** (extended absence 2-4 hours):

Mid-day appointments:
• "need to step out" / "have to leave early" / "leaving at noon"
• "doctor appointment" / "dentist" / "appointment at..."
• "have an appointment" / "gotta run an errand"

Partial day:
• "coming in late" + duration > 2 hours
• "half day" / "partial day" / "few hours"
• "be gone for a while" / "out for a bit"

Any duration 2-4 hours = HALF_DAY

**FULL_DAY - SICK** (health-related full day absence):

Illness keywords:
• "sick" / "ill" / "not feeling well" / "unwell" / "under the weather"
• "flu" / "fever" / "cold" / "covid" / "coronavirus" / "tested positive"
• "throwing up" / "vomiting" / "nauseous" / "stomach" / "food poisoning"
• "headache" / "migraine" / "dizzy" / "lightheaded"
• "sore throat" / "cough" / "congested" / "allergies"
• "back pain" / "hurt" / "injured" / "pain"
• "diarrhea" / "bathroom" / "can't stop..."

Medical:
• "doctor" / "hospital" / "ER" / "emergency room" / "urgent care"
• "clinic" / "medical" / "nurse" / "appointment" (health context)
• "prescription" / "medication" / "meds"
• "staying home sick" / "too sick to work"

**FULL_DAY - PERSONAL** (non-health full day absence):

Family/Personal:
• "family emergency" / "family matter" / "family issue"
• "personal day" / "personal matter" / "personal business"
• "kid is sick" / "kids are sick" / "child care" / "babysitter"
• "spouse" / "husband" / "wife" / "parent" / "relative"

Appointments/Obligations:
• "appointment" (non-medical) / "have to go to..."
• "court" / "legal" / "lawyer" / "dmv" / "license"
• "interview" / "meeting" / "orientation"
• "funeral" / "burial" / "memorial" / "passed away"
• "wedding" / "graduation" / "ceremony"

Life events:
• "moving" / "house" / "home" / "plumber" / "electrician" / "repair"
• "car in shop" / "mechanic" / "no transportation" / "car broke down"
• "errands" / "groceries" / "shopping" / "picking up..."
• "mental health" / "stress" / "need a day" / "burnout"

Generic absence (assume personal):
• "not coming in" / "can't come in" / "won't be in"
• "can't make it" / "not gonna make it" / "taking today off"
• "need the day" / "taking a day"

**UNCLEAR** (cannot determine):
• Just greetings: "hi" / "hey" / "hello" / "sup" / "yo"
• Single random words: "help" / "what" / "huh"
• No useful context: "?"
• Completely irrelevant text

═══════════════════════════════════════════════════════════════════
REASON EXTRACTION - BE SMART
═══════════════════════════════════════════════════════════════════

Accept ANY specific reason mentioned:
✅ "traffic" → "Traffic"
✅ "need to do groceries" → "Groceries"
✅ "doctor appointment" → "Doctor appointment"
✅ "flu" → "Flu"
✅ "family emergency" → "Family emergency"
✅ "car broke down" → "Car trouble"

Only flag as missing_reason if TRULY vague:
❌ "I'll be late" (no reason given)
❌ "can't come in" (no reason given)
❌ "not today" (no reason given)

If they mention a reason, accept it - don't be picky!

═══════════════════════════════════════════════════════════════════
COMPREHENSIVE EXAMPLES - LEARN THESE PATTERNS
═══════════════════════════════════════════════════════════════════

**EDGE CASE EXAMPLES:**

1. "3 hours. Need to do groceries."
→ {"type": "half_day", "subtype": "personal", "reason": "Groceries", "duration_minutes": 180, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

2. "RUNNING LATE TRAFFIC BAD" (all caps, no punctuation)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

3. "cant come in sicl with flu" (typos)
→ {"type": "full_day", "subtype": "sick", "reason": "Flu", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

4. "gonna b late 2hrs trafic" (text speak, typo)
→ {"type": "half_day", "subtype": "personal", "reason": "Traffic", "duration_minutes": 120, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

5. "😷 sick today" (emoji)
→ {"type": "full_day", "subtype": "sick", "reason": "Sick", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

6. "car broke down. be there in an hour" (compound)
→ {"type": "late", "subtype": null, "reason": "Car broke down", "duration_minutes": 60, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

7. "Dr appt tmrw 3hrs" (abbreviations)
→ {"type": "half_day", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 180, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

8. "can i come in late? stuck in traffic" (question format)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

9. "sorry running behind overslept 30 min" (apology + compound)
→ {"type": "late", "subtype": null, "reason": "Overslept", "duration_minutes": 30, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

10. "feaver and headake not feeling good" (multiple typos)
→ {"type": "full_day", "subtype": "sick", "reason": "Fever and headache", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

11. "need to step out for dentist" (implied appointment)
→ {"type": "unclear_duration", "subtype": "personal", "reason": "Dentist appointment", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

12. "be there soon traffic" (vague duration)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": 15, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

13. "kids sick gotta stay home" (child care)
→ {"type": "full_day", "subtype": "personal", "reason": "Kids sick - child care", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

14. "couple hours late groceries" (informal duration)
→ {"type": "half_day", "subtype": "personal", "reason": "Groceries", "duration_minutes": 120, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

15. "I will be late this morning" (no details)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": null, "has_duration": false, "has_reason": false, "missing_duration": true, "missing_reason": true}

16. "180 minutes" (just numbers - from follow-up)
→ {"type": "half_day", "subtype": "personal", "reason": null, "duration_minutes": 180, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

17. "30min" (compact format)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 30, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

18. "half day appointment" (clear)
→ {"type": "half_day", "subtype": "personal", "reason": "Appointment", "duration_minutes": 240, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

19. "leaving early family emergency" (urgent)
→ {"type": "unclear_duration", "subtype": "personal", "reason": "Family emergency", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

20. "throwing up all night cant come in" (sick detail)
→ {"type": "full_day", "subtype": "sick", "reason": "Throwing up", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

21. "1-2 hours late" (range)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 90, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

22. "not coming in today personal matter" (clear absence)
→ {"type": "full_day", "subtype": "personal", "reason": "Personal matter", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

23. "on my way just 15 late traffic" (already coming)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": 15, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

24. "taking the day mental health" (mental health)
→ {"type": "full_day", "subtype": "personal", "reason": "Mental health day", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

25. "court today" (legal)
→ {"type": "full_day", "subtype": "personal", "reason": "Court", "duration_minutes": 480, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

**FOLLOW-UP MESSAGE EXAMPLES (when conversation history exists):**

26. Current message: "1 hour" (after being asked "how late will you be?")
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 60, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

27. Current message: "groceries" (after being asked "why are you running late?")
→ {"type": "late", "subtype": null, "reason": "Groceries", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

28. Current message: "traffic" (when we already have duration from previous message)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

29. Current message: "2 hours" (after being asked "how long will you be out?")
→ {"type": "half_day", "subtype": "personal", "reason": null, "duration_minutes": 120, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

30. Current message: "doctor appointment" (when we already have duration from conversation)
→ {"type": null, "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT - JSON ONLY
══════════════════════════════════════════════════════════════════

YOU MUST respond with ONLY valid JSON. Start with { and end with }.

{
  "type": "late|half_day|full_day|unclear|unclear_duration",
  "subtype": "sick|personal|null",
  "reason": "extracted reason or null",
  "duration_minutes": number or null,
  "has_duration": boolean,
  "has_reason": boolean,
  "missing_duration": boolean,
  "missing_reason": boolean
}

Field Definitions:
• type: Primary classification (late/half_day/full_day/unclear/unclear_duration)
• subtype: For full_day/half_day, is it "sick" or "personal"? null for late
• reason: The specific reason extracted from message, or null
• duration_minutes: Extracted duration in minutes, or null
• has_duration: true if any duration info found (even implied like "all day")
• has_reason: true if any reason found (even minimal like "traffic")
• missing_duration: true if we need to ask for duration
• missing_reason: true if we need to ask for reason

RESPOND WITH JSON ONLY - NO EXPLANATIONS!`;

    console.log('   🔄 Calling Claude API...');
    console.log('   📝 Message to parse:', messageBody);

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    console.log('   ✅ Claude API responded');
    let responseText = message.content[0].text;
    console.log('   🤖 Claude response:', responseText);

    // Strip markdown code blocks if present
    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Extract JSON from response (sometimes Claude adds explanation before JSON)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      responseText = jsonMatch[0];
    }

    console.log('   📋 Cleaned response:', responseText);

    // Parse JSON response
    const parsed = JSON.parse(responseText);

    console.log('   📊 Parsed data:', JSON.stringify(parsed, null, 2));

    // Merge with previously collected info from conversation state
    const mergedData = {
      type: parsed.type || (conversationState?.collectedInfo?.type),
      subtype: parsed.subtype || (conversationState?.collectedInfo?.subtype),
      reason: parsed.reason || (conversationState?.collectedInfo?.reason),
      duration_minutes: parsed.duration_minutes || (conversationState?.collectedInfo?.duration_minutes)
    };

    console.log('   🔗 Merged with conversation state:', JSON.stringify(mergedData, null, 2));

    // Handle completely unclear messages
    if (parsed.type === 'unclear' && !conversationState?.collectedInfo?.type) {
      return {
        success: false,
        needs_clarification: true,
        ask_what: 'status', // Ask: are you late, sick, or out?
        error: 'Message unclear'
      };
    }

    // Handle messages with unclear duration (e.g., "doctor appointment" but no time specified)
    if (parsed.type === 'unclear_duration' || (mergedData.type === 'unclear_duration')) {
      // Only ask for duration if we don't already have it
      if (!mergedData.duration_minutes) {
        return {
          success: false,
          needs_clarification: false,
          ask_what: 'duration', // Ask: how long?
          type: mergedData.type,
          subtype: mergedData.subtype,
          reason: mergedData.reason,
          error: 'Duration not specified'
        };
      }
    }

    // Use merged data for final type determination
    const finalType = mergedData.type === 'unclear_duration' ? 'half_day' : mergedData.type;

    // Check if we need to ask for duration (only for non-full-day absences)
    const needsDuration = !mergedData.duration_minutes && finalType !== 'full_day' && finalType !== 'unclear';
    if (needsDuration) {
      console.log('   ⚠️ Missing duration');
      return {
        success: false,
        needs_clarification: false,
        ask_what: 'duration',
        type: finalType,
        subtype: mergedData.subtype,
        reason: mergedData.reason,
        error: 'Duration needed'
      };
    }

    // Check if we need to ask for reason
    if (!mergedData.reason) {
      console.log('   ⚠️ Missing reason');
      return {
        success: false,
        needs_clarification: false,
        ask_what: 'reason',
        type: finalType,
        subtype: mergedData.subtype,
        duration_minutes: mergedData.duration_minutes,
        error: 'Reason needed'
      };
    }

    // Success - we have all the info we need
    console.log('   ✅ All required info collected!');
    return {
      success: true,
      type: finalType,
      subtype: mergedData.subtype,
      reason: mergedData.reason,
      duration_minutes: mergedData.duration_minutes
    };

  } catch (error) {
    console.error('❌ Error parsing message with Claude:', error);
    console.error('   Error details:', error.message);
    console.error('   Stack:', error.stack);
    return {
      success: false,
      error: error.message
    };
  }
};

// Log absence from SMS
exports.logAbsenceFromSMS = async ({ employee, parsedData, originalMessage, phoneNumber }) => {
  try {
    const callTime = new Date();
    const noticeCheck = attendanceService.checkNoticeTime(employee, callTime);

    let absenceType = 'sick'; // Database type field
    const duration = parsedData.duration_minutes || 0;

    // Classify based on duration
    if (parsedData.type === 'late') {
      // < 2 hours late
      absenceType = 'late';
    } else if (parsedData.type === 'half_day') {
      // 2-4 hours = half day absence
      absenceType = parsedData.subtype || 'personal'; // Use subtype (sick/personal)
    } else if (parsedData.type === 'full_day') {
      // 4+ hours or full day
      absenceType = parsedData.subtype || 'sick'; // Use subtype (sick/personal)
    }

    // Format reason with duration info
    let formattedReason = parsedData.reason || 'No reason provided';
    if (parsedData.type === 'late' && duration > 0) {
      formattedReason = `${duration} min - ${formattedReason}`;
    } else if (parsedData.type === 'half_day' && duration > 0) {
      const hours = Math.round(duration / 60 * 10) / 10; // Round to 1 decimal
      formattedReason = `${hours} hours - ${formattedReason}`;
    }

    const absence = await Absence.create({
      employee_id: employee._id,
      employee_name: employee.name,
      date: new Date(),
      type: absenceType,
      reason: formattedReason,
      expected_return: null, // Can be added later if needed
      report_time: callTime,
      report_method: 'sms',
      report_message: originalMessage,
      late_notice: noticeCheck.isLateNotice,
      organization_id: employee.organization_id // CRITICAL: Assign to employee's organization
    });

    console.log(`✅ ABSENCE SAVED FROM SMS:`);
    console.log(`   ID: ${absence._id}`);
    console.log(`   Employee: ${employee.name}`);
    console.log(`   Type: ${absenceType} (${parsedData.type})`);
    console.log(`   Duration: ${duration} minutes`);

    return absence;

  } catch (error) {
    console.error('Error logging absence from SMS:', error);
    throw error;
  }
};

// Generate response message
exports.generateResponseMessage = async (employee, absence, parsedData) => {
  const duration = parsedData.duration_minutes || 0;

  let message = `Got it, ${employee.name}. `;

  // Confirm what was logged
  if (parsedData.type === 'late') {
    const mins = duration > 0 ? `${duration} min` : 'late';
    message += `Logged as late (${mins}). ✅`;
  } else if (parsedData.type === 'half_day') {
    const hours = duration > 0 ? `${Math.round(duration / 60 * 10) / 10} hours` : 'half day';
    const typeLabel = parsedData.subtype === 'sick' ? 'sick (half day)' : 'personal (half day)';
    message += `Logged as ${typeLabel} (${hours}). ✅`;
  } else if (parsedData.type === 'full_day') {
    const typeLabel = parsedData.subtype === 'sick' ? 'sick' : 'personal day';
    message += `Logged as ${typeLabel}. ✅`;
  }

  return message;
};

module.exports = exports;
