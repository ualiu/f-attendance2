const Anthropic = require('@anthropic-ai/sdk');
const Absence = require('../models/Absence');
const ConversationState = require('../models/ConversationState');
const attendanceService = require('./attendanceService');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Get conversation state
exports.getConversationState = async (phoneNumber) => {
  try {
    const conversation = await ConversationState.findOne({
      phone_number: phoneNumber,
      expires_at: { $gt: new Date() } // Only get non-expired conversations
    });

    if (!conversation) return null;

    const fifteenMinutesAgo = Date.now() - (15 * 60 * 1000);
    if (conversation.timestamp.getTime() < fifteenMinutesAgo) {
      // Conversation expired - delete it
      await ConversationState.deleteOne({ _id: conversation._id });
      return null;
    }

    return conversation;
  } catch (error) {
    console.error('Error getting conversation state:', error);
    return null; // Fail gracefully
  }
};

// Update conversation state
exports.updateConversationState = async (phoneNumber, messageBody, parsedData, questionAsked = null, transcript = null) => {
  try {
    // Find existing conversation or prepare new one
    let existing = await ConversationState.findOne({ phone_number: phoneNumber });

    if (!existing) {
      existing = new ConversationState({
        phone_number: phoneNumber,
        messages: [],
        collected_info: {},
        transcript: [],
        timestamp: new Date(),
        expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes from now
      });
    }

    // Update timestamp and expiration
    existing.timestamp = new Date();
    existing.expires_at = new Date(Date.now() + 15 * 60 * 1000); // Extend expiration

    // Add message if provided
    if (messageBody) {
      existing.messages.push({
        text: messageBody,
        timestamp: new Date()
      });
    }

    // Preserve transcript if passed in (to avoid losing it on reassignment)
    if (transcript) {
      existing.transcript = transcript;
    } else if (!existing.transcript) {
      existing.transcript = [];
    }

    // Update collected info
    if (parsedData) {
      if (!existing.collected_info) {
        existing.collected_info = {};
      }

      if (parsedData.type && !existing.collected_info.type) {
        existing.collected_info.type = parsedData.type;
      }
      if (parsedData.subtype && !existing.collected_info.subtype) {
        existing.collected_info.subtype = parsedData.subtype;
      }
      if (parsedData.reason && !existing.collected_info.reason) {
        existing.collected_info.reason = parsedData.reason;
      }
      if (parsedData.duration_minutes && !existing.collected_info.duration_minutes) {
        existing.collected_info.duration_minutes = parsedData.duration_minutes;
      }
    }

    if (questionAsked) {
      existing.last_question_asked = questionAsked;
    }

    // Save to database
    await existing.save();

    // Clean up old entries (over 20 minutes old) - MongoDB TTL will handle this automatically
    // But we can also do a manual cleanup occasionally (use 20 min to be safe beyond 15 min TTL)
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    await ConversationState.deleteMany({ timestamp: { $lt: twentyMinutesAgo } });

    return existing;
  } catch (error) {
    console.error('Error updating conversation state:', error);
    throw error;
  }
};

// Clear conversation (when successfully logged)
exports.clearConversation = async (phoneNumber) => {
  try {
    await ConversationState.deleteOne({ phone_number: phoneNumber });
  } catch (error) {
    console.error('Error clearing conversation:', error);
    // Don't throw - this is a cleanup operation
  }
};

// Parse attendance message using Claude
exports.parseAttendanceMessage = async (messageBody, employee, organizationName = 'your company', conversationState = null, timezoneContext = null) => {
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

    // Build timezone context
    let timezoneInfo = '';
    if (timezoneContext) {
      timezoneInfo = `
═══════════════════════════════════════════════════════════════════
CURRENT DATE & TIME (Organization Timezone: ${timezoneContext.timezone})
═══════════════════════════════════════════════════════════════════

📅 CURRENT TIME: ${timezoneContext.currentTime}

🚨 CRITICAL: Use this current time to understand time references in the message:
• "away from 1:30 to 2:30" - Calculate if this is future or happening now
• "this afternoon" - Understand what time that means relative to NOW
• "later today" - Know what time of day it currently is
• Calculate exact durations from time ranges (e.g., 1:30-2:30 = 60 minutes)

`;
    }

    const prompt = `You are an attendance assistant for ${organizationName}. Parse employee messages naturally and extract key information. Be EXTREMELY flexible and forgiving - employees text quickly and informally.

Employee: ${employee.name}
Shift: ${employee.shift}
Started: ${employee.start_date ? new Date(employee.start_date).toLocaleDateString() : 'Unknown'}
${timezoneInfo}${conversationContext}
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

🚨 CRITICAL: UNDERSTAND THE DIFFERENCE BETWEEN LATE vs ABSENCE 🚨

**LATE** = Delayed arrival ONLY at START of shift (coming to work late)
• Keywords: "running late", "be there soon", "stuck in traffic", "on my way"
• "overslept", "leaving now", "15 min late", "gonna be late"
• Context: Employee IS COMING TO WORK but will arrive late
• THIS IS ONLY FOR MORNING/SHIFT START DELAYS!

**ABSENCE** = Not present during work hours OR leaving during shift
• Keywords: "away", "stepping out", "leaving early", "appointment", "gone"
• "away from 1:30 to 2:30", "doctor appointment", "need to step out"
• "sick", "not coming in", "taking time off"
• Context: Employee is ABSENT from work (either mid-day, partial, or full day)

🚨 MOST CRITICAL RULE 🚨:
• "AWAY FROM X TO Y" = ALWAYS ABSENCE (half_day), NEVER late!
• "I'm away afternoon from 1:30 to 2:30" = ABSENCE (half_day)
• "Stepping out for appointment" = ABSENCE
• "Away for 1 hour" = ABSENCE
• ANY message with specific time ranges ("from X to Y") = ABSENCE

CLASSIFICATION RULES:
1. First, determine if it's LATE (arrival delay at shift start) or ABSENCE (mid-day/full-day)
   • If message mentions "away", "stepping out", "leaving", or specific times → ABSENCE
   • If message mentions "running late", "on my way", "stuck in traffic" → LATE
2. If LATE → always type "late" (regardless of duration)
3. If ABSENCE → classify by duration:
   🚨 CRITICAL - DURATION CLASSIFICATION:
   • < 2 hours (< 120 min) → "short_absence" with subtype sick/personal
   • 2-4 hours (120-240 min) → "half_day" with subtype sick/personal
   • 4+ hours (240+ min) → "full_day" with subtype sick/personal

   EXAMPLES:
   • 1 hour away = "short_absence" (NOT half_day!)
   • 1.5 hours away = "short_absence" (NOT half_day!)
   • 2 hours away = "half_day"
   • 3 hours away = "half_day"
   • 5 hours away = "full_day"

EXAMPLES:
• "running late 30 min" → LATE (arrival delay at shift start)
• "away from 1:30 to 2:30 for appointment" → SHORT_ABSENCE (1 hour absence, NOT half_day!)
• "I'm away afternoon from 1:30 to 2:30 because I have doctors appointment" → SHORT_ABSENCE (60 min, NOT half_day!)
• "doctor appointment 1 hour" → SHORT_ABSENCE (1 hour absence during workday, NOT half_day!)
• "stuck in traffic, be there in 1 hour" → LATE (arrival delay at shift start)
• "stepping out for 3 hours" → HALF_DAY (3 hour mid-day absence)
• "away for 2 hours" → HALF_DAY (2 hours = half day threshold)
• "leaving early for appointment" → ABSENCE (type depends on duration)
• "sick today" → FULL_DAY (full day absence)

═══════════════════════════════════════════════════════════════════
DATE DETECTION - HANDLE TOMORROW AND FUTURE DATES
═══════════════════════════════════════════════════════════════════

Extract the date reference from messages:

**TODAY (default):**
• "today" / "this morning" / "right now" / "currently" / "can't come in"
• "I'll be late" / "running late" / "sick" (no time reference)
• Any message without a future date reference → default to "today"

**TOMORROW:**
• "tomorrow" / "tmrw" / "tmr" / "2morrow"
• "tomorrow morning" / "tomorrow afternoon"
• "won't be in tomorrow" / "late tomorrow"
• "texting you tonight about tomorrow" / "evening before for tomorrow"

**SPECIFIC DATES:**
• "Monday" / "Tuesday" / "Wednesday" / "Thursday" / "Friday" / "Saturday" / "Sunday"
• "next Monday" / "this Friday"
• Actual dates: "12/25" / "December 25" / "Jan 5"

**EXAMPLES:**
• "I won't be coming in tomorrow" → date: "tomorrow"
• "tomorrow I'll be late" → date: "tomorrow"
• "sick tomorrow" → date: "tomorrow"
• "texting tonight - won't be in tomorrow" → date: "tomorrow"
• "I'll be late this morning" → date: "today"
• "running late" → date: "today" (default)
• "won't be in Monday" → date: "Monday"

═══════════════════════════════════════════════════════════════════
COMPREHENSIVE SCENARIO DETECTION (for context only - DURATION rules above)
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

Short appointments (< 2 hours):
• "quick appointment" / "1 hour appointment" / "doctor for an hour"

Any duration < 120 min = LATE

**HALF_DAY** (extended absence 2-4 hours):

Extended appointments (2-4 hours):
• "need to step out for a few hours" / "have to leave early"
• "doctor appointment" (with 2-4 hour duration)
• "long appointment" / "extended appointment"

Partial day:
• "coming in late" + duration 120-240 minutes
• "half day" / "partial day" / "few hours"
• "be gone for a while" / "out for a bit"

Any duration 120-240 min = HALF_DAY

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
→ {"type": "half_day", "subtype": "personal", "reason": "Groceries", "duration_minutes": 180, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

2. "RUNNING LATE TRAFFIC BAD" (all caps, no punctuation)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "date": "today", "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

3. "cant come in sicl with flu" (typos)
→ {"type": "full_day", "subtype": "sick", "reason": "Flu", "duration_minutes": 480, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

4. "gonna b late 2hrs trafic" (text speak, typo)
→ {"type": "half_day", "subtype": "personal", "reason": "Traffic", "duration_minutes": 120, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

5. "😷 sick today" (emoji)
→ {"type": "full_day", "subtype": "sick", "reason": "Sick", "duration_minutes": 480, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

6. "car broke down. be there in an hour" (compound)
→ {"type": "late", "subtype": null, "reason": "Car broke down", "duration_minutes": 60, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

7. "Dr appt tmrw 3hrs" (abbreviations + tomorrow)
→ {"type": "half_day", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 180, "date": "tomorrow", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

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

15. "I'll be away for an hour for an appointment" (1 hour mid-day absence = HALF_DAY)
→ {"type": "half_day", "subtype": "personal", "reason": "Appointment", "duration_minutes": 60, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

16. "doctor appointment 1 hour" (1 hour mid-day absence = HALF_DAY)
→ {"type": "half_day", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 60, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

17. "away from 1:30 to 2:30 for doctors appointment" (specific time = mid-day ABSENCE = HALF_DAY, NOT late!)
→ {"type": "half_day", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 60, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

17b. "I'm away afternoon from 1:30 to 2:30 because I have doctors appointment" (mid-day ABSENCE = HALF_DAY, NOT late!)
→ {"type": "half_day", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 60, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

18. "I will be late this morning" (arrival delay at shift start, no details)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": null, "date": "today", "has_duration": false, "has_reason": false, "missing_duration": true, "missing_reason": true}

19. "stuck in traffic, be there in 1 hour" (arrival delay at shift start = LATE, not absence!)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": 60, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

20. "180 minutes" (just numbers - from follow-up)
→ {"type": "half_day", "subtype": "personal", "reason": null, "duration_minutes": 180, "date": "today", "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

21. "30min" (compact format - arrival delay)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 30, "date": "today", "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

22. "half day appointment" (clear)
→ {"type": "half_day", "subtype": "personal", "reason": "Appointment", "duration_minutes": 240, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

23. "leaving early family emergency" (urgent)
→ {"type": "unclear_duration", "subtype": "personal", "reason": "Family emergency", "duration_minutes": null, "date": "today", "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

24. "throwing up all night cant come in" (sick detail)
→ {"type": "full_day", "subtype": "sick", "reason": "Throwing up", "duration_minutes": 480, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

25. "1-2 hours late" (range - arrival delay)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 90, "date": "today", "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

26. "not coming in today personal matter" (clear absence)
→ {"type": "full_day", "subtype": "personal", "reason": "Personal matter", "duration_minutes": 480, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

27. "on my way just 15 late traffic" (arrival delay - already coming)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": 15, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

28. "taking the day mental health" (mental health)
→ {"type": "full_day", "subtype": "personal", "reason": "Mental health day", "duration_minutes": 480, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

27. "court today" (legal)
→ {"type": "full_day", "subtype": "personal", "reason": "Court", "duration_minutes": 480, "date": "today", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

28. "won't be coming in tomorrow" (tomorrow reference)
→ {"type": "full_day", "subtype": "personal", "reason": null, "duration_minutes": 480, "date": "tomorrow", "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

29. "tomorrow I'll be late" (future date + late)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": null, "date": "tomorrow", "has_duration": false, "has_reason": false, "missing_duration": true, "missing_reason": true}

30. "texting tonight - sick tomorrow" (evening before for tomorrow)
→ {"type": "full_day", "subtype": "sick", "reason": "Sick", "duration_minutes": 480, "date": "tomorrow", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

31. "1 hour late tomorrow for appointment" (tomorrow + duration)
→ {"type": "late", "subtype": null, "reason": "Appointment", "duration_minutes": 60, "date": "tomorrow", "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

**FOLLOW-UP MESSAGE EXAMPLES (when conversation history exists):**

28. Current message: "1 hour" (after being asked "how late will you be?")
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 60, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

29. Current message: "groceries" (after being asked "why are you running late?")
→ {"type": "late", "subtype": null, "reason": "Groceries", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

30. Current message: "traffic" (when we already have duration from previous message)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

31. Current message: "2 hours" (after being asked "how long will you be out?")
→ {"type": "half_day", "subtype": "personal", "reason": null, "duration_minutes": 120, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

32. Current message: "doctor appointment" (when we already have duration from conversation)
→ {"type": null, "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": null, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT - JSON ONLY
══════════════════════════════════════════════════════════════════

YOU MUST respond with ONLY valid JSON. Start with { and end with }.

{
  "type": "late|short_absence|half_day|full_day|unclear|unclear_duration",
  "subtype": "sick|personal|null",
  "reason": "extracted reason or null",
  "duration_minutes": number or null,
  "date": "today|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|specific date",
  "has_duration": boolean,
  "has_reason": boolean,
  "missing_duration": boolean,
  "missing_reason": boolean
}

Field Definitions:
• type: Primary classification (late/short_absence/half_day/full_day/unclear/unclear_duration)
  - late: Arrival delay at shift start (any duration)
  - short_absence: Mid-day absence < 2 hours
  - half_day: Mid-day absence 2-4 hours
  - full_day: Absence 4+ hours or all day
• subtype: For short_absence/half_day/full_day, is it "sick" or "personal"? null for late
• reason: The specific reason extracted from message, or null
• duration_minutes: Extracted duration in minutes, or null
• date: Date reference ("today", "tomorrow", day name, or specific date). Default to "today" if not specified
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
exports.logAbsenceFromSMS = async ({ employee, parsedData, originalMessage, phoneNumber, transcript = [], organization }) => {
  try {
    console.log('   💾 logAbsenceFromSMS called with transcript length:', transcript.length);
    console.log('   💾 Transcript content:', JSON.stringify(transcript, null, 2));

    const callTime = new Date();
    const noticeCheck = attendanceService.checkNoticeTime(employee, callTime, organization);

    let absenceType = 'sick'; // Database type field
    const duration = parsedData.duration_minutes || 0;

    // Classify based on duration
    if (parsedData.type === 'late') {
      // Arrival delay at shift start
      absenceType = 'late';
    } else if (parsedData.type === 'short_absence') {
      // < 2 hours mid-day absence
      absenceType = parsedData.subtype || 'personal'; // Use subtype (sick/personal)
    } else if (parsedData.type === 'half_day') {
      // 2-4 hours = half day absence
      absenceType = parsedData.subtype || 'personal'; // Use subtype (sick/personal)
    } else if (parsedData.type === 'full_day') {
      // 4+ hours or full day
      absenceType = parsedData.subtype || 'sick'; // Use subtype (sick/personal)
    }

    // Calculate actual absence date based on extracted date (use UTC to avoid timezone issues)
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();
    let absenceDate = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

    const dateRef = parsedData.date || 'today';

    if (dateRef === 'tomorrow') {
      // Add 1 day
      absenceDate.setUTCDate(absenceDate.getUTCDate() + 1);
    } else if (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(dateRef)) {
      // Calculate next occurrence of this day
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const targetDay = dayNames.indexOf(dateRef);
      const currentDay = absenceDate.getUTCDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // If day has passed this week, go to next week
      absenceDate.setUTCDate(absenceDate.getUTCDate() + daysToAdd);
    }
    // Otherwise use today (default)

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
      date: absenceDate, // Use calculated date instead of new Date()
      type: absenceType,
      reason: formattedReason,
      expected_return: null, // Can be added later if needed
      report_time: callTime,
      report_method: 'sms',
      report_message: originalMessage,
      conversation_transcript: transcript, // Full conversation history
      late_notice: noticeCheck.isLateNotice,
      late_duration_minutes: absenceType === 'late' ? duration : null, // Only for lates
      minutes_before_shift: noticeCheck.minutesBeforeShift, // Track advance notice
      policy_violation: noticeCheck.isLateNotice, // Flag if less than 30 minutes notice
      organization_id: employee.organization_id // CRITICAL: Assign to employee's organization
    });

    console.log(`✅ ABSENCE SAVED FROM SMS:`);
    console.log(`   ID: ${absence._id}`);
    console.log(`   Employee: ${employee.name}`);
    console.log(`   Type: ${absenceType} (${parsedData.type})`);
    console.log(`   Duration: ${duration} minutes`);
    console.log(`   Date: ${absenceDate.toLocaleDateString()} (${dateRef})`);
    console.log(`   ⏰ Advance notice: ${noticeCheck.minutesBeforeShift} minutes before shift`);
    console.log(`   ${noticeCheck.isLateNotice ? '⚠️  POLICY VIOLATION: Less than 30 minutes notice' : '✅ Policy compliant: 30+ minutes notice'}`);
    console.log(`   💾 Saved transcript length: ${absence.conversation_transcript?.length || 0}`);
    console.log(`   💾 Saved transcript:`, JSON.stringify(absence.conversation_transcript, null, 2));

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
  } else if (parsedData.type === 'short_absence') {
    const hours = duration > 0 ? `${Math.round(duration / 60 * 10) / 10} hours` : 'short absence';
    const typeLabel = parsedData.subtype === 'sick' ? 'sick' : 'personal';
    message += `Logged as ${typeLabel} (${hours}). ✅`;
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
