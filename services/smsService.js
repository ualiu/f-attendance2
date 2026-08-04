const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Absence = require('../models/Absence');
const ConversationState = require('../models/ConversationState');
const attendanceService = require('./attendanceService');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Call the configured LLM provider and return the raw text response.
// `model` lets a caller override the default (e.g. coverageService uses a
// cheaper model for yes/no reply classification without touching the
// absence-parsing default below).
async function callLLM(prompt, { provider = 'claude', maxTokens = 500, model = null } = {}) {
  if (provider === 'openai') {
    console.log('   🔄 Calling OpenAI API...');
    const completion = await openai.chat.completions.create({
      model: model || process.env.OPENAI_MODEL || 'gpt-4o',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }]
    });
    console.log('   ✅ OpenAI API responded');
    return completion.choices[0].message.content;
  }

  console.log('   🔄 Calling Claude API...');
  const message = await anthropic.messages.create({
    model: model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-5-20251101',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  });
  console.log('   ✅ Claude API responded');
  return message.content[0].text;
}

exports.callLLM = callLLM;

// ── Conversation memory semantics ────────────────────────────────────────────
// "Ambiguous" placeholders must NEVER overwrite an established concrete value;
// concrete values MAY overwrite (employees must be able to correct us).
const AMBIGUOUS_TYPES = new Set(['unclear', 'unclear_duration']);
const MERGEABLE_FIELDS = ['type', 'subtype', 'reason', 'duration_minutes', 'date'];

function isConcreteValue(field, value) {
  if (value === null || value === undefined || value === '') return false;
  // The prompt's output spec literally contains the token `null`, so the LLM
  // sometimes emits the STRING "null". Treat it as empty.
  if (typeof value === 'string' && value.trim().toLowerCase() === 'null') return false;
  if (field === 'type') return !AMBIGUOUS_TYPES.has(value);
  if (field === 'duration_minutes') return Number.isFinite(value) && value > 0;
  return true;
}

// Duration is the authority for ABSENCE classification (see CLAUDE.md).
// `late` is a shift-start arrival delay and is never reclassified by duration.
function classifyAbsenceByDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 120) return 'short_absence';
  if (minutes <= 240) return 'half_day';
  return 'full_day';
}

function resolveField(field, storedValue, incomingValue, opts = {}) {
  const { lastQuestionAsked = null, isCorrection = false } = opts;
  const incomingConcrete = isConcreteValue(field, incomingValue);
  const storedConcrete = isConcreteValue(field, storedValue);

  // Ambiguous/empty never clobbers. Keep what we had, including a placeholder
  // like 'unclear_duration' if that's all we have.
  if (!incomingConcrete) {
    return (storedValue !== null && storedValue !== undefined)
      ? storedValue
      : (incomingValue === undefined ? null : incomingValue);
  }
  if (!storedConcrete) return incomingValue;   // nothing established yet
  if (isCorrection) return incomingValue;      // explicit correction wins

  // `type` is INFERRED, not stated. When the employee is answering a question
  // WE asked, their reply is a fragment - re-classifying from it is exactly the
  // reported bug ("I have an appointment" -> late, clobbering full_day).
  if (field === 'type' &&
      (lastQuestionAsked === 'reason' || lastQuestionAsked === 'duration')) {
    return storedValue;
  }

  // Otherwise a later concrete value is a correction-by-restatement.
  return incomingValue;
}

// Single source of truth for merge precedence. Used by parseAttendanceMessage
// (in-request), updateConversationState (persistence), and the test harness,
// so the three can never disagree.
exports.mergeCollectedInfo = (storedInfo = {}, incoming = {}, opts = {}) => {
  const merged = {};
  for (const field of MERGEABLE_FIELDS) {
    merged[field] = resolveField(field, storedInfo?.[field], incoming?.[field], opts);
  }
  return merged;
};

// Resolve a date reference ("today"/"tomorrow"/weekday) to UTC midnight.
// Extracted from logAbsenceFromSMS so the harness can assert dates with no DB.
exports.resolveAbsenceDate = (dateRef, now = new Date()) => {
  const base = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const ref = String(dateRef || 'today').trim().toLowerCase();

  if (ref === 'tomorrow') {
    base.setUTCDate(base.getUTCDate() + 1);
    return base;
  }

  // Case-insensitive weekday match (the previous inline version was
  // case-sensitive, so "monday" silently fell through to today).
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const targetDay = dayNames.indexOf(ref);
  if (targetDay !== -1) {
    let daysToAdd = targetDay - base.getUTCDay();
    if (daysToAdd <= 0) daysToAdd += 7; // day already passed this week -> next week
    base.setUTCDate(base.getUTCDate() + daysToAdd);
    return base;
  }

  return base; // "today" or unrecognised
};

exports.isConcreteValue = isConcreteValue;
exports.classifyAbsenceByDuration = classifyAbsenceByDuration;

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

    // A doc can outlive its TTL: Mongo's TTL monitor sweeps only ~every 60s, and
    // getConversationState returns null for an expired doc WITHOUT deleting it.
    // Reviving it here would leak stale collected_info into a brand-new
    // conversation. (Invisible before the snake_case fix, because those reads
    // were no-ops.)
    if (existing && existing.expires_at && existing.expires_at.getTime() <= Date.now()) {
      console.log('   🧹 Discarding expired conversation state for', phoneNumber);
      await ConversationState.deleteOne({ _id: existing._id });
      existing = null;
    }

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

    // Update collected info.
    // `parsedData` here is ALWAYS the return value of parseAttendanceMessage,
    // which is already question-aware-merged, so no lastQuestionAsked guard is
    // re-applied (doing so would revert a duration-derived reclassification).
    // Semantics that DO apply: concrete values overwrite (corrections work),
    // ambiguous/empty values never clobber. Previously this was write-once, so
    // an employee's correction was silently discarded.
    if (parsedData) {
      if (!existing.collected_info) {
        existing.collected_info = {};
      }

      const merged = exports.mergeCollectedInfo({ ...(existing.collected_info || {}) }, parsedData);

      // Per-leaf assignment ONLY. Replacing existing.collected_info wholesale
      // drops schema defaults for any key absent from the new object.
      for (const field of MERGEABLE_FIELDS) {
        if (merged[field] !== undefined) {
          existing.collected_info[field] = merged[field];
        }
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

// Mark a conversation as logged, keeping it alive so the employee can correct
// the record. Previously the conversation was deleted immediately, which made
// "reply if that's wrong" impossible - the reply looked like a brand-new report.
exports.markConversationLogged = async (phoneNumber, absence, summary) => {
  try {
    const existing = await ConversationState.findOne({ phone_number: phoneNumber });
    if (!existing) return null;

    existing.status = 'logged';
    existing.last_absence_id = absence._id;
    existing.last_absence_summary = summary;
    existing.last_question_asked = null;
    existing.timestamp = new Date();
    existing.expires_at = new Date(Date.now() + 15 * 60 * 1000);

    await existing.save();
    return existing;
  } catch (error) {
    console.error('Error marking conversation logged:', error);
    return null; // non-fatal: worst case the correction window is unavailable
  }
};

// Return a logged conversation to the collecting state after the employee
// disputes the record. collected_info is wiped because the LLM is instructed to
// restate the FULL corrected picture, so carrying the old values forward would
// only let stale fields leak back in. The transcript is kept as evidence.
exports.reopenConversationForCorrection = async (phoneNumber) => {
  try {
    const existing = await ConversationState.findOne({ phone_number: phoneNumber });
    if (!existing) return null;

    existing.status = 'collecting';
    existing.last_absence_id = null;
    existing.last_absence_summary = null;
    existing.last_question_asked = null;
    for (const field of MERGEABLE_FIELDS) {
      existing.collected_info[field] = null;
    }
    existing.timestamp = new Date();
    existing.expires_at = new Date(Date.now() + 15 * 60 * 1000);

    await existing.save();
    console.log('   🔄 Conversation reopened for correction');
    return existing;
  } catch (error) {
    console.error('Error reopening conversation:', error);
    return null;
  }
};

// Undo an absence the employee says we got wrong. Deliberately narrow: only the
// single record this conversation just created, only inside the 15-minute
// window, and only scoped to that employee.
exports.undoLoggedAbsence = async (absenceId, employeeId) => {
  try {
    const deleted = await Absence.findOneAndDelete({
      _id: absenceId,
      employee_id: employeeId
    });
    if (deleted) {
      console.log(`   ↩️  UNDID absence ${absenceId} (${deleted.type} on ${deleted.date.toISOString().slice(0, 10)}) - employee said it was wrong`);
    } else {
      console.log(`   ⚠️  Could not undo absence ${absenceId} - not found for this employee`);
    }
    return deleted;
  } catch (error) {
    console.error('Error undoing absence:', error);
    return null;
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
exports.parseAttendanceMessage = async (messageBody, employee, organizationName = 'your company', conversationState = null, timezoneContext = null, llmProvider = 'claude') => {
  try {
    // Build conversation context if this is a follow-up.
    // Gate on REAL memory, not just message count: state can be meaningful on a
    // short thread, and a stale doc can inflate the count.
    let conversationContext = '';
    const hasMemory = conversationState && (
      (conversationState.messages && conversationState.messages.length > 1) ||
      conversationState.last_question_asked ||
      isConcreteValue('type', conversationState.collected_info?.type)
    );
    if (hasMemory) {
      conversationContext = '\n\n═══════════════════════════════════════════════════════════════════\n';
      conversationContext += 'CONVERSATION HISTORY (This is a follow-up message)\n';
      conversationContext += '═══════════════════════════════════════════════════════════════════\n\n';
      conversationContext += 'Previous messages in this conversation:\n';

      // Show previous messages (excluding the current one we're parsing)
      const previousMessages = (conversationState.messages || []).slice(0, -1);
      previousMessages.forEach((msg, idx) => {
        conversationContext += `${idx + 1}. "${msg.text}"\n`;
      });

      // Show what we've collected so far.
      // NOTE: field is `collected_info` (snake_case) to match the Mongoose
      // schema. Reading `collectedInfo` here was always undefined, which made
      // conversation memory a total no-op.
      const collected = conversationState.collected_info || {};
      conversationContext += '\nINFO ALREADY COLLECTED:\n';
      // `type` is gated on isConcreteValue so we never present a placeholder
      // like "unclear_duration" to the model as if it were established.
      if (isConcreteValue('type', collected.type)) {
        conversationContext += `- Type: ${collected.type}\n`;
      }
      if (collected.subtype) {
        conversationContext += `- Subtype: ${collected.subtype}\n`;
      }
      if (collected.reason) {
        conversationContext += `- Reason: ${collected.reason}\n`;
      }
      if (collected.duration_minutes) {
        conversationContext += `- Duration: ${collected.duration_minutes} minutes\n`;
      }
      if (collected.date) {
        conversationContext += `- Date: ${collected.date}\n`;
      }

      // Show what question was asked, and frame the reply as an ANSWER to it.
      // Without this the model re-classifies the fragment as a brand-new report:
      // answering "what's the reason?" with "I have an appointment" was being
      // read as an arrival delay, wiping out an established full-day absence.
      const lastQ = conversationState.last_question_asked;
      if (lastQ) {
        conversationContext += `\nLAST QUESTION WE ASKED: ${lastQ}\n`;
        conversationContext += '\n🚨 THE MESSAGE BELOW IS THE EMPLOYEE ANSWERING THAT QUESTION.\n';
        conversationContext += 'Interpret it as an ANSWER to that question. Do NOT re-classify it as a brand-new standalone report.\n';

        if (lastQ === 'reason') {
          conversationContext += '• Extract `reason` (and `subtype`: sick or personal).\n';
          conversationContext += '• Set "type": null. The type is ALREADY ESTABLISHED above and must not change.\n';
          conversationContext += '• A reason is NOT a duration and NOT an arrival delay. If they answer\n';
          conversationContext += '  "I have an appointment" to "what\'s the reason?", the REASON is an appointment.\n';
          conversationContext += '  It does NOT mean they are running late and does NOT shorten the absence.\n';
          conversationContext += '• Set "date": null unless they name a different day.\n';
        } else if (lastQ === 'duration') {
          conversationContext += '• Extract `duration_minutes` only. Set "type": null unless they also restate the kind of absence.\n';
          conversationContext += '• "all day" / "the whole day" / "not coming in at all" / "the full shift" = 480 minutes.\n';
          conversationContext += '• Set "date": null unless they name a different day.\n';
        } else if (lastQ === 'status') {
          conversationContext += '• This answers WHAT KIND of absence it is. Classify `type` normally.\n';
        } else if (lastQ === 'subtype') {
          conversationContext += '• This answers SICK or PERSONAL. Set `subtype` accordingly ("sick"/"not well"/"ill" -> sick;\n';
          conversationContext += '  anything else -> personal). Set "type": null and "date": null - neither is changing.\n';
        } else if (lastQ === 'date') {
          conversationContext += '• This answers WHICH DAY. Set `date` only ("today", "tomorrow", or a weekday name).\n';
          conversationContext += '• Set "type": null and "duration_minutes": null - neither is changing.\n';
        }
      }

      conversationContext += '\n🚨 CRITICAL INSTRUCTIONS FOR FOLLOW-UP MESSAGES:\n';
      conversationContext += '1. If the current message is JUST a duration (e.g., "1 hour", "30 min"), extract it as duration_minutes\n';
      conversationContext += '2. If the current message is JUST a reason (e.g., "groceries", "traffic"), extract it as reason\n';
      conversationContext += '3. Use the INFO ALREADY COLLECTED above - don\'t ask for it again!\n';
      conversationContext += '4. If we already have BOTH duration and reason, set missing_duration=false and missing_reason=false\n';
      conversationContext += '5. NEVER ask the same question twice - check conversation history first!\n';
      // Post-log correction window: we already saved a record and told the
      // employee what it said. Their next message is either a correction to it
      // or an unrelated new report.
      if (conversationState.status === 'logged' && conversationState.last_absence_summary) {
        conversationContext += `\n📌 WE ALREADY LOGGED: ${conversationState.last_absence_summary}\n`;
        conversationContext += 'We told the employee this and invited them to reply if it was wrong.\n';
        conversationContext += '• If this message disputes/adjusts THAT record ("no", "that\'s wrong", "actually just\n';
        conversationContext += '  the morning", "not sick, personal", "I meant Tuesday"), set "is_correction": true\n';
        conversationContext += '  and give the CORRECTED full picture (type, duration, date, reason, subtype).\n';
        conversationContext += '• If it is clearly an unrelated NEW report for a different day or situation,\n';
        conversationContext += '  set "is_correction": false and parse it as a fresh report.\n';
      }

      conversationContext += '6. CORRECTIONS OVERRIDE EVERYTHING: if the employee is pushing back or\n';
      conversationContext += '   restating something we got wrong ("I said I can\'t come in tomorrow",\n';
      conversationContext += '   "no, I meant...", "actually...", "not late, I\'m OUT all day", "I already told you"),\n';
      conversationContext += '   set "is_correction": true and re-parse their FULL intent from that message,\n';
      conversationContext += '   including "type" and "date". Their corrected values REPLACE what we collected.\n';
      conversationContext += '   Otherwise set "is_correction": false.\n';
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

**Time of arrival (calculate from now):**
• "be there at 8:30" → Calculate delay from shift start
• "in 30" / "in thirty" / "30 from now" → 30 minutes

🚨🚨 NEVER INVENT A DURATION. ASK INSTEAD. 🚨🚨

These records are used for discipline and payroll, so a guessed number is worse
than an extra text message. If the employee has NOT given you enough to know how
long they will be gone, set "duration_minutes": null and "type": "unclear_duration".

VAGUE - these do NOT tell you a duration. Set null and let us ask:
❌ "soon" / "shortly" / "in a bit" / "a while" / "not long" / "a few"
❌ "bit late" / "little late" / "running behind" (late, but HOW late is unknown)
❌ "long time" / "most of the day" / "a good while"
❌ "later" / "sometime today" / "when I can"

DO NOT map any of the above to 15, 30 or 60 minutes. There is no default.

**Implied full day — ONLY when the message states TOTAL absence:**
These say the employee will not be at work AT ALL, so 480 minutes is certain:
✅ "all day" / "the whole day" / "not coming in" / "can't come in" / "won't be in"
✅ "taking the day" / "taking today off" / "out today" / "can't make it in"
✅ "off tomorrow" / "not in tomorrow"
→ 480 minutes, type "full_day"

**A CONDITION IS NOT A DURATION — ask how much work they will miss:**
These describe a situation but NOT how long they are gone. They might be out all
day, or leaving early, or coming in late. Do NOT assume 480.
❌ "I'm sick" / "not feeling well" / "under the weather" / "I have the flu"
❌ "I have an appointment" / "doctor appointment" / "have to see the dentist"
❌ "family emergency" / "car trouble" / "kid is sick"
→ set "duration_minutes": null, "type": "unclear_duration", keep the subtype/reason

The difference is SCOPE, not severity. Naming a DAY is not naming a DURATION:
• "I'm sick" → unclear_duration (sick HOW long? all day? leaving early?)
• "sick today" → unclear_duration ("today" says WHICH day, not how much of it)
• "I'm sick, can't come in" → full_day, 480 (they said they aren't coming)
• "out sick today" / "not coming in today" → full_day, 480 ("out"/"not coming in"
  states total absence; "today" then tells us which day)

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

**SUBTYPE "sick"** (health-related). These words tell you the SUBTYPE.
They do NOT by themselves tell you the DURATION - only use full_day if the
message also states total absence ("can't come in", "today", "all day"):

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

**SUBTYPE "personal"** (non-health). These words tell you the SUBTYPE.
They do NOT by themselves tell you the DURATION - an appointment or errand is
often only part of a day, so ask unless total absence is stated:

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
→ {"type": "half_day", "subtype": "personal", "reason": "Groceries", "duration_minutes": 180, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

2. "RUNNING LATE TRAFFIC BAD" (all caps, no punctuation)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "date": "today", "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

3. "cant come in sicl with flu" (typos)
→ {"type": "full_day", "subtype": "sick", "reason": "Flu", "duration_minutes": 480, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

4. "gonna b late 2hrs trafic" (text speak, typo)
→ {"type": "half_day", "subtype": "personal", "reason": "Traffic", "duration_minutes": 120, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

5. "😷 sick today" (emoji; a condition + a DAY, but no scope - do NOT assume all day)
→ {"type": "unclear_duration", "subtype": "sick", "reason": "Sick", "duration_minutes": null, "date": "today", "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

5b. "😷 out sick today" ("out" states total absence)
→ {"type": "full_day", "subtype": "sick", "reason": "Sick", "duration_minutes": 480, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

6. "car broke down. be there in an hour" (compound)
→ {"type": "late", "subtype": null, "reason": "Car broke down", "duration_minutes": 60, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

7. "Dr appt tmrw 3hrs" (abbreviations + tomorrow)
→ {"type": "half_day", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 180, "date": "tomorrow", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

8. "can i come in late? stuck in traffic" (question format)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "date": "today", "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

9. "sorry running behind overslept 30 min" (apology + compound)
→ {"type": "late", "subtype": null, "reason": "Overslept", "duration_minutes": 30, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

10. "feaver and headake not feeling good" (multiple typos; a CONDITION with no scope - do NOT assume all day)
→ {"type": "unclear_duration", "subtype": "sick", "reason": "Fever and headache", "duration_minutes": null, "date": "today", "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}
   WHY not 480: they said they feel ill, not that they are staying home. They might
   be coming in late or leaving early. We ask instead of guessing.

11. "need to step out for dentist" (implied appointment)
→ {"type": "unclear_duration", "subtype": "personal", "reason": "Dentist appointment", "duration_minutes": null, "date": "today", "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

12. "be there soon traffic" ("soon" is NOT a duration - never turn it into 15 minutes)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "date": "today", "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

13. "kids sick gotta stay home" (child care)
→ {"type": "full_day", "subtype": "personal", "reason": "Kids sick - child care", "duration_minutes": 480, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

14. "couple hours late groceries" (informal duration)
→ {"type": "half_day", "subtype": "personal", "reason": "Groceries", "duration_minutes": 120, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

15. "I'll be away for an hour for an appointment" (60 min mid-day absence = SHORT_ABSENCE, under 2 hours)
→ {"type": "short_absence", "subtype": "personal", "reason": "Appointment", "duration_minutes": 60, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

16. "doctor appointment 1 hour" (60 min mid-day absence = SHORT_ABSENCE, under 2 hours)
→ {"type": "short_absence", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 60, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

17. "away from 1:30 to 2:30 for doctors appointment" (specific time = mid-day ABSENCE, 60 min = SHORT_ABSENCE, NOT late!)
→ {"type": "short_absence", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 60, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

17b. "I'm away afternoon from 1:30 to 2:30 because I have doctors appointment" (mid-day ABSENCE, 60 min = SHORT_ABSENCE, NOT late!)
→ {"type": "short_absence", "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": 60, "date": "today", "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

18. "I will be late this morning" (arrival delay at shift start, no details)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": null, "date": "today", "duration_stated": false, "has_duration": false, "has_reason": false, "missing_duration": true, "missing_reason": true}

19. "stuck in traffic, be there in 1 hour" (arrival delay at shift start = LATE, not absence!)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": 60, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

20. "180 minutes" (just numbers - from follow-up)
→ {"type": "half_day", "subtype": "personal", "reason": null, "duration_minutes": 180, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

21. "30min" (compact format - arrival delay)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 30, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

22. "half day appointment" (clear)
→ {"type": "half_day", "subtype": "personal", "reason": "Appointment", "duration_minutes": 240, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

23. "leaving early family emergency" (urgent)
→ {"type": "unclear_duration", "subtype": "personal", "reason": "Family emergency", "duration_minutes": null, "date": "today", "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": true, "missing_reason": false}

24. "throwing up all night cant come in" (sick detail)
→ {"type": "full_day", "subtype": "sick", "reason": "Throwing up", "duration_minutes": 480, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

25. "1-2 hours late" (range - arrival delay)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 90, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

26. "not coming in today personal matter" (clear absence)
→ {"type": "full_day", "subtype": "personal", "reason": "Personal matter", "duration_minutes": 480, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

27. "on my way just 15 late traffic" (arrival delay - already coming)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": 15, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

28. "taking the day mental health" (mental health)
→ {"type": "full_day", "subtype": "personal", "reason": "Mental health day", "duration_minutes": 480, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

27. "court today" (legal)
→ {"type": "full_day", "subtype": "personal", "reason": "Court", "duration_minutes": 480, "date": "today", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

28. "won't be coming in tomorrow" (tomorrow reference)
→ {"type": "full_day", "subtype": "personal", "reason": null, "duration_minutes": 480, "date": "tomorrow", "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

29. "tomorrow I'll be late" (future date + late)
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": null, "date": "tomorrow", "duration_stated": false, "has_duration": false, "has_reason": false, "missing_duration": true, "missing_reason": true}

30. "texting tonight - sick tomorrow" (evening before for tomorrow)
→ {"type": "full_day", "subtype": "sick", "reason": "Sick", "duration_minutes": 480, "date": "tomorrow", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

31. "1 hour late tomorrow for appointment" (tomorrow + duration)
→ {"type": "late", "subtype": null, "reason": "Appointment", "duration_minutes": 60, "date": "tomorrow", "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}

**FOLLOW-UP MESSAGE EXAMPLES (when conversation history exists):**

28. Current message: "1 hour" (after being asked "how late will you be?")
→ {"type": "late", "subtype": null, "reason": null, "duration_minutes": 60, "date": null, "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

29. Current message: "groceries" (after being asked "why are you running late?")
→ {"type": "late", "subtype": null, "reason": "Groceries", "duration_minutes": null, "date": null, "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

30. Current message: "traffic" (when we already have duration from previous message)
→ {"type": "late", "subtype": null, "reason": "Traffic", "duration_minutes": null, "date": null, "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

31. Current message: "2 hours" (after being asked "how long will you be out?")
→ {"type": "half_day", "subtype": "personal", "reason": null, "duration_minutes": 120, "date": null, "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

32. Current message: "doctor appointment" (when we already have duration from conversation)
→ {"type": null, "subtype": "personal", "reason": "Doctor appointment", "duration_minutes": null, "date": null, "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}

33. LAST QUESTION WE ASKED: reason | ALREADY COLLECTED: Type: full_day, Date: tomorrow
    Current message: "I have an appointment"
→ {"type": null, "subtype": "personal", "reason": "Appointment", "duration_minutes": null, "date": null, "is_correction": false, "duration_stated": false, "has_duration": false, "has_reason": true, "missing_duration": false, "missing_reason": false}
   WHY type is null: the employee is answering "what's the reason?". The absence is
   ALREADY established as full_day. An appointment is their REASON for missing the
   whole day - it does NOT mean they are merely running late.

34. ALREADY COLLECTED: Type: late, Duration: 30
    Current message: "I said I can't come in tomorrow"
→ {"type": "full_day", "subtype": "personal", "reason": null, "duration_minutes": 480, "date": "tomorrow", "is_correction": true, "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}
   WHY is_correction is true: "I said" signals we got it wrong. Re-parse fully and
   override the stored late/30min with full_day/480min/tomorrow.

35. LAST QUESTION WE ASKED: duration | ALREADY COLLECTED: Type: unclear_duration, Subtype: personal
    Current message: "all day"
→ {"type": null, "subtype": "personal", "reason": null, "duration_minutes": 480, "date": null, "is_correction": false, "duration_stated": true, "has_duration": true, "has_reason": false, "missing_duration": false, "missing_reason": true}

36. ALREADY COLLECTED: Type: late, Duration: 30
    Current message: "actually I can't come in at all today, family emergency"
→ {"type": "full_day", "subtype": "personal", "reason": "Family emergency", "duration_minutes": 480, "date": "today", "is_correction": true, "duration_stated": true, "has_duration": true, "has_reason": true, "missing_duration": false, "missing_reason": false}
   WHY is_correction is true: "actually" plus "at all" contradicts the stored late.

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
  "is_correction": boolean,
  "duration_stated": boolean,
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
• date: Date reference ("today", "tomorrow", day name, or specific date).
  Use "today" when the timing makes it clear (the normal case - a message sent
  during or shortly before the shift is about today). Set null ONLY when the day
  is genuinely ambiguous, e.g. a message sent late in the evening after the shift
  has already ended, where "I'm sick" could mean tonight or the next working day.
  When null we will ask. Do not set null just because the word "today" is absent.
• is_correction: true ONLY if the employee is explicitly correcting or restating something
  we previously got wrong ("I said...", "no, I meant...", "actually..."). Default false.
• duration_stated: THE MOST IMPORTANT FLAG. true ONLY if the employee's OWN WORDS say how
  much work they will miss. Set it false if you worked the number out yourself.
    true  → "30 min late", "2 hours", "half day", "all day", "can't come in",
            "not coming in", "taking the day off", "out today", "won't be in"
    false → "I'm sick", "sick today", "not feeling well", "I have an appointment",
            "be there soon", "running a bit late", "family emergency"
  If false we will ASK the employee instead of recording a guess. When in doubt use false -
  an extra text message is much cheaper than a wrong attendance record.
• has_duration: true if any duration info found (even implied like "all day")
• has_reason: true if any reason found (even minimal like "traffic")
• missing_duration: true if we need to ask for duration
• missing_reason: true if we need to ask for reason

RESPOND WITH JSON ONLY - NO EXPLANATIONS!`;

    console.log('   📝 Message to parse:', messageBody);
    console.log('   🧠 LLM provider:', llmProvider);

    let responseText = await callLLM(prompt, { provider: llmProvider, maxTokens: 500 });
    console.log('   🤖 LLM response:', responseText);

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

    // Merge with previously collected info from conversation state.
    // Precedence lives in mergeCollectedInfo so parse, persistence and the test
    // harness can never disagree. Critically: when the employee is answering a
    // question WE asked, their reply is a fragment and must not re-classify the
    // absence (that is the "appointment -> late" bug).
    // After a record is logged we start the merge from a CLEAN slate: the LLM is
    // told to restate the full corrected picture, and an unrelated new report
    // must not inherit the previous absence's reason/date.
    const isPostLog = conversationState?.status === 'logged';
    const storedInfo = isPostLog ? {} : (conversationState?.collected_info || {});
    const lastQuestion = conversationState?.last_question_asked || null;
    const isCorrection = parsed.is_correction === true; // absent => false, never throws

    // STRUCTURAL GUARD: only a duration the employee actually STATED may be
    // logged. An inferred one is discarded so we ask instead.
    //
    // This cannot be left to the prompt: providers disagree on messages like
    // "sick today" (Claude asks; gpt-4o infers a full day) even with a near
    // identical few-shot present. Discarding the value in code makes the
    // behaviour identical across providers. Note the fail-safe direction - if a
    // model omits the flag entirely we ask rather than assume.
    const durationWasStated = parsed.duration_stated === true;
    const incomingDuration = durationWasStated ? parsed.duration_minutes : null;
    // A full_day claim rests entirely on the duration, so it is downgraded too.
    const incomingType = (!durationWasStated && parsed.type === 'full_day')
      ? 'unclear_duration'
      : parsed.type;

    if (!durationWasStated && parsed.duration_minutes) {
      console.log(`   🚧 Discarded INFERRED duration ${parsed.duration_minutes} min - will ask instead`);
    }

    const mergedData = exports.mergeCollectedInfo(storedInfo, {
      type: incomingType,
      subtype: parsed.subtype,
      reason: parsed.reason,
      duration_minutes: incomingDuration,
      date: parsed.date
    }, { lastQuestionAsked: lastQuestion, isCorrection });

    console.log('   🔗 Merged with conversation state:', JSON.stringify(mergedData, null, 2));
    if (isCorrection) {
      console.log('   ✏️  Employee is CORRECTING us - stored values overwritten');
    }

    // Handle completely unclear messages
    if (parsed.type === 'unclear' && !isConcreteValue('type', storedInfo.type)) {
      return {
        success: false,
        needs_clarification: true,
        ask_what: 'status', // Ask: are you late, sick, or out?
        date: mergedData.date,
        is_correction: isCorrection,
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
          date: mergedData.date,
          is_correction: isCorrection,
        error: 'Duration not specified'
        };
      }
    }

    // Final type. Duration is the authority for ABSENCES: the old code coerced
    // `unclear_duration` to half_day unconditionally, so a full-day absence that
    // passed through it got logged as a HALF DAY. `late` is an arrival delay and
    // is never reclassified by duration.
    let finalType = mergedData.type;
    if (!isConcreteValue('type', finalType)) {
      finalType = classifyAbsenceByDuration(mergedData.duration_minutes) || finalType;
    } else if (finalType !== 'late') {
      const byDuration = classifyAbsenceByDuration(mergedData.duration_minutes);
      if (byDuration) finalType = byDuration;
    }

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
        date: mergedData.date,
        is_correction: isCorrection,
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
        date: mergedData.date,
        is_correction: isCorrection,
        error: 'Reason needed'
      };
    }

    // Check whether this is sick or personal. Absences only - `late` has no
    // subtype by design. This usually resolves itself from the reason answer
    // ("flu" -> sick, "appointment" -> personal), so it rarely fires; but when
    // it does we ask rather than silently defaulting, because the subtype is
    // what lands in the Absence.type column.
    const isAbsence = finalType !== 'late' && finalType !== 'unclear';
    if (isAbsence && !mergedData.subtype) {
      console.log('   ⚠️ Missing subtype (sick vs personal)');
      return {
        success: false,
        needs_clarification: false,
        ask_what: 'subtype',
        type: finalType,
        reason: mergedData.reason,
        duration_minutes: mergedData.duration_minutes,
        date: mergedData.date,
        is_correction: isCorrection,
        error: 'Subtype needed'
      };
    }

    // Check which day this is for. The prompt resolves obvious cases to "today"
    // and only emits null when the day is genuinely ambiguous.
    if (!mergedData.date) {
      console.log('   ⚠️ Missing date');
      return {
        success: false,
        needs_clarification: false,
        ask_what: 'date',
        type: finalType,
        subtype: mergedData.subtype,
        reason: mergedData.reason,
        duration_minutes: mergedData.duration_minutes,
        is_correction: isCorrection,
        error: 'Date needed'
      };
    }

    // Success - we have all the info we need
    console.log('   ✅ All required info collected!');
    return {
      success: true,
      type: finalType,
      subtype: mergedData.subtype,
      reason: mergedData.reason,
      duration_minutes: mergedData.duration_minutes,
      date: mergedData.date, // consumed by logAbsenceFromSMS
      is_correction: isCorrection
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

    // Calculate actual absence date from the extracted date reference (UTC).
    // parseAttendanceMessage now returns `date`; before, it was dropped and this
    // always fell through to today.
    const dateRef = parsedData.date || 'today';
    const absenceDate = exports.resolveAbsenceDate(dateRef, new Date());

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

// Choose the follow-up question for a failed parse.
// Lives here rather than in the route so the SMS test harness exercises the
// exact wording employees receive.
exports.buildFollowUpQuestion = (parsedData, employee, isFollowUp = false) => {
  // Only greet on the first message, not on follow-ups
  const greeting = isFollowUp ? '' : `Hi ${employee.name}, `;

  if (parsedData.ask_what === 'status') {
    return {
      questionAsked: 'status',
      message: `${greeting}are you running late, calling out sick, or taking time off?`
    };
  }

  if (parsedData.ask_what === 'duration') {
    // A full_day absence has no "how long" left to ask. parseAttendanceMessage
    // already guards this; this is belt-and-braces so we can never ask someone
    // who is out all day "how late will you be?".
    if (parsedData.type === 'full_day') {
      return {
        questionAsked: 'reason',
        message: `${greeting}what's the reason? (e.g., appointment, errands, family matter)`
      };
    }
    if (parsedData.type === 'late') {
      return {
        questionAsked: 'duration',
        message: `${greeting}how late will you be? (e.g., "30 min", "2 hours")`
      };
    }
    // short_absence / half_day / unclear_duration are ABSENCES, not arrival
    // delays. `unclear_duration` used to be lumped in with `late`, which is what
    // produced "how late will you be?" for someone who was out for the day.
    return {
      questionAsked: 'duration',
      message: `${greeting}how long will you be out? (e.g., "an hour", "few hours", "all day")`
    };
  }

  if (parsedData.ask_what === 'subtype') {
    return {
      questionAsked: 'subtype',
      message: `${greeting}is this a sick day or a personal day?`
    };
  }

  if (parsedData.ask_what === 'date') {
    return {
      questionAsked: 'date',
      message: `${greeting}which day is this for - today or tomorrow?`
    };
  }

  if (parsedData.ask_what === 'reason') {
    if (parsedData.type === 'late') {
      return {
        questionAsked: 'reason',
        message: `${greeting}why are you running late? (e.g., traffic, car trouble, appointment)`
      };
    }
    if (parsedData.subtype === 'sick') {
      return {
        questionAsked: 'reason',
        message: `${greeting}what's going on? (e.g., flu, headache, doctor visit)`
      };
    }
    return {
      questionAsked: 'reason',
      message: `${greeting}what's the reason? (e.g., appointment, errands, family matter)`
    };
  }

  // Fallback - generic help
  return {
    questionAsked: 'help',
    message: `${greeting}please text something like: "Running 30 min late - traffic" or "Sick with flu" or "Out for appointment"`
  };
};

// Human-readable day label for confirmations ("today" / "tomorrow" / "Monday")
function formatDateLabel(dateRef) {
  const ref = String(dateRef || 'today').trim().toLowerCase();
  if (ref === 'today' || ref === 'tomorrow') return ref;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const idx = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(ref);
  return idx !== -1 ? dayNames[idx] : ref;
}

// Generate response message.
// This states back EXACTLY what was recorded - duration and day included - so any
// inference the system made is visible to the employee and can be corrected while
// the conversation window is still open.
exports.generateResponseMessage = async (employee, absence, parsedData) => {
  const duration = parsedData.duration_minutes || 0;
  const hours = Math.round(duration / 60 * 10) / 10;
  const when = formatDateLabel(parsedData.date);
  const sick = parsedData.subtype === 'sick';

  let what;
  if (parsedData.type === 'late') {
    what = duration > 0 ? `in ${duration} min late` : 'in late';
  } else if (parsedData.type === 'full_day') {
    what = `out all day (${sick ? 'sick' : 'personal'})`;
  } else if (parsedData.type === 'half_day' || parsedData.type === 'short_absence') {
    what = `out ${hours} ${hours === 1 ? 'hour' : 'hours'} (${sick ? 'sick' : 'personal'})`;
  } else {
    what = 'recorded';
  }

  const reason = parsedData.reason ? ` - ${parsedData.reason}` : '';

  return `Got it, ${employee.name}. Logged: ${what} ${when}${reason}. ✅ ` +
         `If that's not right, just reply and tell me what to change.`;
};

module.exports = exports;
