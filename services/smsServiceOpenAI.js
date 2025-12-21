const OpenAI = require("openai");
const Absence = require("../models/Absence");
const attendanceService = require("./attendanceService");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Warn if API key is not configured
if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  WARNING: OPENAI_API_KEY is not set in environment variables!');
  console.warn('   OpenAI SMS parsing will fail. Please add OPENAI_API_KEY to your .env file.');
}

// Track recent conversations with full state
// Key: phone number, Value: { timestamp, messages, collectedInfo }
const recentConversations = new Map();

// Check if this is a continuation of a recent conversation (within 10 minutes)
exports.isFollowUpMessage = (phoneNumber) => {
  const conversation = recentConversations.get(phoneNumber);
  if (!conversation) return false;

  const tenMinutesAgo = Date.now() - 10 * 60 * 1000; // 10 minutes
  const isFollowUp = conversation.timestamp > tenMinutesAgo;

  return isFollowUp;
};

// Get conversation state
exports.getConversationState = (phoneNumber) => {
  const conversation = recentConversations.get(phoneNumber);
  if (!conversation) return null;

  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
  if (conversation.timestamp < tenMinutesAgo) {
    // Conversation expired
    recentConversations.delete(phoneNumber);
    return null;
  }

  return conversation;
};

// Update conversation state
exports.updateConversationState = (
  phoneNumber,
  messageBody,
  parsedData,
  questionAsked = null,
  transcript = null
) => {
  const existing = recentConversations.get(phoneNumber) || {
    messages: [],
    collectedInfo: {},
    transcript: [],
  };

  existing.timestamp = Date.now();
  if (messageBody) {
    existing.messages.push({
      text: messageBody,
      timestamp: Date.now(),
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
    if (parsedData.type && !existing.collectedInfo.type) {
      existing.collectedInfo.type = parsedData.type;
    }
    if (parsedData.subtype && !existing.collectedInfo.subtype) {
      existing.collectedInfo.subtype = parsedData.subtype;
    }
    if (parsedData.reason && !existing.collectedInfo.reason) {
      existing.collectedInfo.reason = parsedData.reason;
    }
    if (
      parsedData.duration_minutes &&
      !existing.collectedInfo.duration_minutes
    ) {
      existing.collectedInfo.duration_minutes = parsedData.duration_minutes;
    }
  }

  if (questionAsked) {
    existing.lastQuestionAsked = questionAsked;
  }

  recentConversations.set(phoneNumber, existing);

  // Clean up old entries (over 15 minutes old)
  const fifteenMinutesAgo = Date.now() - 15 * 60 * 1000;
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

// Parse attendance message using OpenAI GPT-5 Mini
exports.parseAttendanceMessage = async (
  messageBody,
  employee,
  organizationName = "your company",
  conversationState = null,
  timezoneContext = null
) => {
  try {
    // Build conversation context if this is a follow-up
    let conversationContext = "";
    if (
      conversationState &&
      conversationState.messages &&
      conversationState.messages.length > 1
    ) {
      conversationContext =
        "\n\n═══════════════════════════════════════════════════════════════════\n";
      conversationContext +=
        "CONVERSATION HISTORY (This is a follow-up message)\n";
      conversationContext +=
        "═══════════════════════════════════════════════════════════════════\n\n";
      conversationContext += "Previous messages in this conversation:\n";

      // Show previous messages (excluding the current one we're parsing)
      const previousMessages = conversationState.messages.slice(0, -1);
      previousMessages.forEach((msg, idx) => {
        conversationContext += `${idx + 1}. "${msg.text}"\n`;
      });

      // Show what we've collected so far
      if (
        conversationState.collectedInfo &&
        Object.keys(conversationState.collectedInfo).length > 0
      ) {
        conversationContext += "\nINFO ALREADY COLLECTED:\n";
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

      conversationContext +=
        "\n🚨 CRITICAL INSTRUCTIONS FOR FOLLOW-UP MESSAGES:\n";
      conversationContext +=
        '1. If the current message is JUST a duration (e.g., "1 hour", "30 min"), extract it as duration_minutes\n';
      conversationContext +=
        '2. If the current message is JUST a reason (e.g., "groceries", "traffic"), extract it as reason\n';
      conversationContext +=
        "3. Use the INFO ALREADY COLLECTED above - don't ask for it again!\n";
      conversationContext +=
        "4. If we already have BOTH duration and reason, set missing_duration=false and missing_reason=false\n";
      conversationContext +=
        "5. NEVER ask the same question twice - check conversation history first!\n";
      conversationContext +=
        "═══════════════════════════════════════════════════════════════════\n";
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
Started: ${
      employee.start_date
        ? new Date(employee.start_date).toLocaleDateString()
        : "Unknown"
    }
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
OUTPUT FORMAT - JSON ONLY
═══════════════════════════════════════════════════════════════════

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

    console.log("   🔄 Calling OpenAI API (GPT-5 Mini)...");
    console.log("   📝 Message to parse:", messageBody);

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an attendance assistant. Parse employee absence/late messages and respond with ONLY valid JSON. No explanations, no markdown code blocks, just raw JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_completion_tokens: 500,
      });
    } catch (apiError) {
      console.error("   ❌ OpenAI API call failed:", apiError.message);
      console.error("   Error code:", apiError.code);
      console.error("   Error type:", apiError.type);
      return {
        success: false,
        ask_what: 'help',
        error: `OpenAI API Error: ${apiError.message}`
      };
    }

    console.log("   ✅ OpenAI API responded");
    let responseText = completion.choices[0].message.content;
    console.log("   🤖 OpenAI response:", responseText);

    // Strip markdown code blocks if present (same as Claude service)
    responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    // Extract JSON from response (sometimes OpenAI adds explanation before JSON)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      responseText = jsonMatch[0];
    }

    console.log("   📋 Cleaned response:", responseText);

    // Parse JSON response
    const parsed = JSON.parse(responseText);

    console.log("   📊 Parsed data:", JSON.stringify(parsed, null, 2));

    // Merge with previously collected info from conversation state
    const mergedData = {
      type: parsed.type || conversationState?.collectedInfo?.type,
      subtype: parsed.subtype || conversationState?.collectedInfo?.subtype,
      reason: parsed.reason || conversationState?.collectedInfo?.reason,
      duration_minutes:
        parsed.duration_minutes ||
        conversationState?.collectedInfo?.duration_minutes,
    };

    console.log(
      "   🔗 Merged with conversation state:",
      JSON.stringify(mergedData, null, 2)
    );

    // Handle completely unclear messages
    if (parsed.type === "unclear" && !conversationState?.collectedInfo?.type) {
      return {
        success: false,
        needs_clarification: true,
        ask_what: "status", // Ask: are you late, sick, or out?
        error: "Message unclear",
      };
    }

    // Handle messages with unclear duration (e.g., "doctor appointment" but no time specified)
    if (
      parsed.type === "unclear_duration" ||
      mergedData.type === "unclear_duration"
    ) {
      // Only ask for duration if we don't already have it
      if (!mergedData.duration_minutes) {
        return {
          success: false,
          needs_clarification: false,
          ask_what: "duration", // Ask: how long?
          type: mergedData.type,
          subtype: mergedData.subtype,
          reason: mergedData.reason,
          error: "Duration not specified",
        };
      }
    }

    // Use merged data for final type determination
    const finalType =
      mergedData.type === "unclear_duration" ? "half_day" : mergedData.type;

    // Check if we need to ask for duration (only for non-full-day absences)
    const needsDuration =
      !mergedData.duration_minutes &&
      finalType !== "full_day" &&
      finalType !== "unclear";
    if (needsDuration) {
      console.log("   ⚠️ Missing duration");
      return {
        success: false,
        needs_clarification: false,
        ask_what: "duration",
        type: finalType,
        subtype: mergedData.subtype,
        reason: mergedData.reason,
        error: "Duration needed",
      };
    }

    // Check if we need to ask for reason
    if (!mergedData.reason) {
      console.log("   ⚠️ Missing reason");
      return {
        success: false,
        needs_clarification: false,
        ask_what: "reason",
        type: finalType,
        subtype: mergedData.subtype,
        duration_minutes: mergedData.duration_minutes,
        error: "Reason needed",
      };
    }

    // Success - we have all the info we need
    console.log("   ✅ All required info collected!");
    return {
      success: true,
      type: finalType,
      subtype: mergedData.subtype,
      reason: mergedData.reason,
      duration_minutes: mergedData.duration_minutes,
      date: parsed.date || "today",
    };
  } catch (error) {
    console.error("❌ Error parsing message with OpenAI:", error);
    console.error("   Error details:", error.message);
    console.error("   Stack:", error.stack);
    return {
      success: false,
      error: error.message,
    };
  }
};

// Log absence from SMS
exports.logAbsenceFromSMS = async ({
  employee,
  parsedData,
  originalMessage,
  phoneNumber,
  transcript = [],
}) => {
  try {
    console.log(
      "   💾 [OpenAI] logAbsenceFromSMS called with transcript length:",
      transcript.length
    );
    console.log(
      "   💾 Transcript content:",
      JSON.stringify(transcript, null, 2)
    );

    const callTime = new Date();
    const noticeCheck = attendanceService.checkNoticeTime(employee, callTime);

    let absenceType = "sick"; // Database type field
    const duration = parsedData.duration_minutes || 0;

    // Classify based on duration
    if (parsedData.type === "late") {
      // Arrival delay at shift start
      absenceType = "late";
    } else if (parsedData.type === "short_absence") {
      // < 2 hours mid-day absence
      absenceType = parsedData.subtype || "personal"; // Use subtype (sick/personal)
    } else if (parsedData.type === "half_day") {
      // 2-4 hours = half day absence
      absenceType = parsedData.subtype || "personal"; // Use subtype (sick/personal)
    } else if (parsedData.type === "full_day") {
      // 4+ hours or full day
      absenceType = parsedData.subtype || "sick"; // Use subtype (sick/personal)
    }

    // Calculate actual absence date based on extracted date
    let absenceDate = new Date();
    absenceDate.setHours(0, 0, 0, 0); // Reset to start of day

    const dateRef = parsedData.date || "today";

    if (dateRef === "tomorrow") {
      // Add 1 day
      absenceDate.setDate(absenceDate.getDate() + 1);
    } else if (
      [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ].includes(dateRef)
    ) {
      // Calculate next occurrence of this day
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const targetDay = dayNames.indexOf(dateRef);
      const currentDay = absenceDate.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // If day has passed this week, go to next week
      absenceDate.setDate(absenceDate.getDate() + daysToAdd);
    }
    // Otherwise use today (default)

    // Format reason with duration info
    let formattedReason = parsedData.reason || "No reason provided";
    if (parsedData.type === "late" && duration > 0) {
      formattedReason = `${duration} min - ${formattedReason}`;
    } else if (parsedData.type === "half_day" && duration > 0) {
      const hours = Math.round((duration / 60) * 10) / 10; // Round to 1 decimal
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
      report_method: "sms",
      report_message: originalMessage,
      conversation_transcript: transcript, // Full conversation history
      late_notice: noticeCheck.isLateNotice,
      organization_id: employee.organization_id, // CRITICAL: Assign to employee's organization
    });

    console.log(`✅ ABSENCE SAVED FROM SMS (OpenAI):`);
    console.log(`   ID: ${absence._id}`);
    console.log(`   Employee: ${employee.name}`);
    console.log(`   Type: ${absenceType} (${parsedData.type})`);
    console.log(`   Duration: ${duration} minutes`);
    console.log(`   Date: ${absenceDate.toLocaleDateString()} (${dateRef})`);
    console.log(
      `   💾 Saved transcript length: ${
        absence.conversation_transcript?.length || 0
      }`
    );
    console.log(
      `   💾 Saved transcript:`,
      JSON.stringify(absence.conversation_transcript, null, 2)
    );

    return absence;
  } catch (error) {
    console.error("Error logging absence from SMS (OpenAI):", error);
    throw error;
  }
};

// Generate response message
exports.generateResponseMessage = async (employee, absence, parsedData) => {
  const duration = parsedData.duration_minutes || 0;

  let message = `Got it, ${employee.name}. `;

  // Confirm what was logged
  if (parsedData.type === "late") {
    const mins = duration > 0 ? `${duration} min` : "late";
    message += `Logged as late (${mins}). ✅`;
  } else if (parsedData.type === "short_absence") {
    const hours = duration > 0 ? `${Math.round((duration / 60) * 10) / 10} hours` : "short absence";
    const typeLabel = parsedData.subtype === "sick" ? "sick" : "personal";
    message += `Logged as ${typeLabel} (${hours}). ✅`;
  } else if (parsedData.type === "half_day") {
    const hours =
      duration > 0
        ? `${Math.round((duration / 60) * 10) / 10} hours`
        : "half day";
    const typeLabel =
      parsedData.subtype === "sick" ? "sick (half day)" : "personal (half day)";
    message += `Logged as ${typeLabel} (${hours}). ✅`;
  } else if (parsedData.type === "full_day") {
    const typeLabel = parsedData.subtype === "sick" ? "sick" : "personal day";
    message += `Logged as ${typeLabel}. ✅`;
  }

  return message;
};

module.exports = exports;
