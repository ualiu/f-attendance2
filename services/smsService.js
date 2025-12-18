const Anthropic = require('@anthropic-ai/sdk');
const Absence = require('../models/Absence');
const attendanceService = require('./attendanceService');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Parse attendance message using Claude
exports.parseAttendanceMessage = async (messageBody, employee) => {
  try {
    const prompt = `You are an expert attendance message parser for Felton Brushes manufacturing company. Your job is to accurately classify employee attendance messages and extract specific details.

Employee: ${employee.name}
Current Points: ${employee.points_current_quarter}
Work Station: ${employee.work_station}
Shift: ${employee.shift}

MESSAGE TO PARSE:
"${messageBody}"

CLASSIFICATION RULES (READ CAREFULLY):

═══════════════════════════════════════════════════════════════════
TYPE: **LATE** - Employee IS coming to work, just delayed/tardy
═══════════════════════════════════════════════════════════════════

Keywords that ALWAYS mean LATE:
• "late" / "delayed" / "tardy" / "behind schedule"
• "running late" / "gonna be late" / "will be late" / "I'll be late"
• "stuck in traffic" / "traffic delay" / "traffic jam"
• "car trouble" / "car won't start" / "flat tire"
• "overslept" / "slept through alarm" / "alarm didn't go off"
• "doctor appointment running over" / "appointment running late"
• "be there soon" / "on my way" / "almost there"
• "15 min late" / "30 minutes" / "hour late"

Common Late Phrases:
• "Running behind"
• "Stuck on highway"
• "Train/bus delayed"
• "Will be there in X minutes"
• "Sorry, traffic is bad"
• "Be in shortly"
• "Leaving now but late"

═══════════════════════════════════════════════════════════════════
TYPE: **SICK** - Employee is NOT coming due to illness/health
═══════════════════════════════════════════════════════════════════

Keywords that mean SICK:
• "sick" / "ill" / "not feeling well" / "unwell"
• "flu" / "fever" / "cold" / "covid" / "coronavirus"
• "throwing up" / "vomiting" / "nauseous" / "stomach bug"
• "headache" / "migraine" / "dizzy"
• "doctor" / "hospital" / "emergency room" / "ER"
• "contagious" / "symptoms" / "tested positive"
• "food poisoning" / "diarrhea"
• "can't come in" / "not coming in" / "won't be in" (without other reason)
• "staying home" (health context)
• "under the weather"
• "feeling terrible" / "really sick"

Common Sick Phrases:
• "I'm not feeling good"
• "Got the flu"
• "Really sick today"
• "Can barely move"
• "Doctor said to stay home"
• "Too sick to work"
• "Caught a bug"
• "Need to rest"
• "Going to urgent care"

═══════════════════════════════════════════════════════════════════
TYPE: **PERSONAL** - Employee is NOT coming for non-health reasons
═══════════════════════════════════════════════════════════════════

Keywords that mean PERSONAL:
• "personal day" / "personal leave" / "personal matter"
• "family emergency" / "family matter" / "family issue"
• "child care" / "babysitter" / "kids are sick"
• "funeral" / "death in family" / "passed away"
• "court" / "legal matter" / "lawyer"
• "appointment" (non-medical context or unspecified)
• "taking the day off" / "need a day off"
• "car in shop" / "no transportation" / "car broke down" (can't make it at all)
• "house emergency" / "plumber" / "water leak"
• "mental health day" / "stress" / "burnout"

Common Personal Phrases:
• "Need to handle something"
• "Personal issue came up"
• "Can't make it today"
• "Taking care of family"
• "Have to deal with something"
• "Emergency at home"
• "Need the day"

═══════════════════════════════════════════════════════════════════
TYPE: **UNCLEAR** - Cannot determine intent, need clarification
═══════════════════════════════════════════════════════════════════

Messages that are UNCLEAR:
• Just greetings: "hi" / "hey" / "hello" / "yo"
• Single word: "help" / "yo" / "sup"
• Vague: "something came up" / "I can't" / "not today"
• No context: "sorry" / "can't make it" (without reason type)
• Ambiguous: "having problems" / "issues" / "trouble"
• Random text / gibberish / accidental messages
• Question only: "what time?" / "when's my shift?"

IMPORTANT CLARIFICATION RULES:
1. If message has LATE keywords (late, delayed, traffic) → type is "late" NOT unclear
2. If message has SICK keywords (sick, ill, fever) → type is "sick" NOT unclear
3. If message has PERSONAL keywords (family, emergency, appointment) → type is "personal" NOT unclear
4. ONLY mark as "unclear" if absolutely no keywords match any category

EXAMPLES (STUDY THESE PATTERNS):

LATE Examples:
✅ "I'll be late" → {"type": "late", "reason": "Running late", "minutes_late": null}
✅ "Running 30 min late" → {"type": "late", "reason": "Running late", "minutes_late": 30}
✅ "Traffic is bad, be there in 20" → {"type": "late", "reason": "Traffic", "minutes_late": 20}
✅ "Car won't start, gonna be late" → {"type": "late", "reason": "Car trouble", "minutes_late": null}
✅ "Stuck on highway" → {"type": "late", "reason": "Traffic delay", "minutes_late": null}
✅ "Overslept, be there soon" → {"type": "late", "reason": "Overslept", "minutes_late": null}
✅ "15 minutes late - alarm didn't go off" → {"type": "late", "reason": "Overslept", "minutes_late": 15}

SICK Examples:
✅ "I'm sick today" → {"type": "sick", "reason": "Feeling sick"}
✅ "Got the flu" → {"type": "sick", "reason": "Flu"}
✅ "Not feeling well" → {"type": "sick", "reason": "Not feeling well"}
✅ "Throwing up" → {"type": "sick", "reason": "Vomiting"}
✅ "Can't come in" → {"type": "sick", "reason": "Unable to come in"}
✅ "Fever and headache" → {"type": "sick", "reason": "Fever and headache"}
✅ "Doctor said stay home" → {"type": "sick", "reason": "Doctor's orders"}
✅ "Covid symptoms" → {"type": "sick", "reason": "COVID symptoms"}

PERSONAL Examples:
✅ "Personal day" → {"type": "personal", "reason": "Personal day"}
✅ "Family emergency" → {"type": "personal", "reason": "Family emergency"}
✅ "Kids are sick" → {"type": "personal", "reason": "Child care - kids sick"}
✅ "Appointment today" → {"type": "personal", "reason": "Appointment"}
✅ "Need to take care of something" → {"type": "personal", "reason": "Personal matter"}
✅ "Car broke down completely" → {"type": "personal", "reason": "No transportation"}
✅ "Court today" → {"type": "personal", "reason": "Legal matter"}

UNCLEAR Examples (need more info):
❌ "Hey" → {"type": "unclear", "needs_clarification": true}
❌ "Can't" → {"type": "unclear", "needs_clarification": true}
❌ "Sorry" → {"type": "unclear", "needs_clarification": true}
❌ "Problem" → {"type": "unclear", "needs_clarification": true}

══════════════════════════════════════════════════════════════════
CRITICAL OUTPUT REQUIREMENTS - READ THIS CAREFULLY:
══════════════════════════════════════════════════════════════════

YOU MUST respond with ONLY valid JSON. NO explanations, NO analysis, NO text before or after the JSON.

CORRECT (✅):
{"type": "late", "reason": "Traffic", "expected_return": null, "minutes_late": 30, "needs_clarification": false}

WRONG (❌):
Looking at this message... [analysis text]
{JSON here}

WRONG (❌):
\`\`\`json
{JSON here}
\`\`\`

YOUR RESPONSE MUST START WITH { AND END WITH }. NOTHING ELSE.

Required JSON format:
{
  "type": "sick|late|personal|unclear",
  "reason": "specific reason from message",
  "expected_return": "YYYY-MM-DD or null",
  "minutes_late": number or null,
  "needs_clarification": boolean
}

REASONING GUIDELINES:
- Be SPECIFIC: "traffic" → "Traffic", NOT "Running late"
- Be SPECIFIC: "flu" → "Flu", NOT "Feeling sick"
- Extract minutes if mentioned (30 min, 1 hour = 60, etc.)
- needs_clarification = true ONLY if type is "unclear"
- Respond immediately with JSON - no thinking out loud`;

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

    // Check if needs clarification
    if (parsed.needs_clarification || parsed.type === 'unclear') {
      return {
        success: false,
        needs_clarification: true,
        needs_reason: false,
        error: 'Message too vague'
      };
    }

    // Validate
    if (!parsed.type || !['sick', 'late', 'personal'].includes(parsed.type)) {
      return {
        success: false,
        needs_clarification: true,
        needs_reason: false,
        error: 'Invalid type'
      };
    }

    // Check if reason is too generic (needs more detail)
    const genericReasons = [
      // Generic absence reasons
      'unable to come in',
      'not coming in',
      'can\'t come in',
      'won\'t be in',
      'absent',
      'not available',
      'can\'t make it',
      'unavailable',

      // Generic late reasons (only vague ones)
      'running late',
      'gonna be late',
      'will be late',
      'late today',
      'behind schedule',

      // Generic sick reasons
      'feeling sick',
      'not feeling well',
      'feeling ill',
      'unwell',
      'sick today',
      'not well',

      // Generic personal reasons
      'personal matter',
      'personal issue',
      'personal business',
      'personal reasons',
      'family matter',
      'family issue',

      // Truly vague
      'no reason provided',
      'not specified',
      'unspecified',
      'something came up',
      'have to deal with something',
      'need to handle something',
      'taking care of something',
      'issues',
      'problems',
      'trouble'
    ];

    const reasonLower = (parsed.reason || '').toLowerCase().trim();

    // Check if reason is too generic or too short
    const isGenericReason = genericReasons.some(generic => {
      // Exact match or very close match
      return reasonLower === generic ||
             reasonLower.includes(generic) ||
             generic.includes(reasonLower);
    });

    // Also check if reason is suspiciously short (less than 4 chars and not specific)
    const isTooShort = reasonLower.length < 4 && !['flu', 'er', 'icu'].includes(reasonLower);

    // For late, also check if minutes are missing
    const needsMinutes = parsed.type === 'late' && !parsed.minutes_late;

    // Check if we need more details
    if (isGenericReason || isTooShort || needsMinutes) {
      console.log('   ⚠️ Needs more details:');
      console.log('      - Generic reason:', isGenericReason);
      console.log('      - Too short:', isTooShort);
      console.log('      - Missing minutes:', needsMinutes);

      return {
        success: false,
        needs_clarification: false,
        needs_reason: true,
        type: parsed.type,
        missing_minutes: needsMinutes,
        error: 'Needs more details'
      };
    }

    return {
      success: true,
      type: parsed.type,
      reason: parsed.reason || 'No reason provided',
      expected_return: parsed.expected_return,
      minutes_late: parsed.minutes_late
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

    let pointsAwarded = 0;
    let type = parsedData.type;

    if (parsedData.type === 'late') {
      type = 'late';
      pointsAwarded = 0.33;
    } else {
      pointsAwarded = attendanceService.calculatePointsToAward(parsedData.type);
    }

    const stationImpact = await attendanceService.checkStationImpact(employee.work_station);

    const absence = await Absence.create({
      employee_id: employee._id,
      employee_name: employee.name,
      work_station: employee.work_station,
      date: new Date(),
      type,
      reason: parsedData.type === 'late'
        ? `${parsedData.minutes_late || 'Unknown'} minutes late - ${parsedData.reason}`
        : parsedData.reason,
      expected_return: parsedData.expected_return ? new Date(parsedData.expected_return) : null,
      report_time: callTime,
      report_method: 'sms',
      report_message: originalMessage,
      points_awarded: pointsAwarded,
      late_notice: noticeCheck.isLateNotice,
      station_impacted: stationImpact.impacted
    });

    console.log(`✅ ABSENCE SAVED FROM SMS:`);
    console.log(`   ID: ${absence._id}`);
    console.log(`   Employee: ${employee.name}`);
    console.log(`   Type: ${type}`);
    console.log(`   Points: ${pointsAwarded}`);

    // Update employee stats
    await attendanceService.updateEmployeeStats(employee._id);

    return absence;

  } catch (error) {
    console.error('Error logging absence from SMS:', error);
    throw error;
  }
};

// Generate response message
exports.generateResponseMessage = async (employee, absence, parsedData) => {
  // Refresh employee to get updated points
  const Employee = require('../models/Employee');
  const updatedEmployee = await Employee.findById(employee._id);

  const points = updatedEmployee.points_current_quarter;

  let message = `Got it, ${employee.name}. `;

  // Confirm what was logged
  if (parsedData.type === 'late') {
    message += `Logged as late (${parsedData.minutes_late || 'unknown'} min). `;
  } else if (parsedData.type === 'sick') {
    message += `Logged as sick. `;
  } else {
    message += `Logged as personal day. `;
  }

  // Points status
  message += `You now have ${points} points. `;

  // Status messages
  if (points >= 6) {
    message += `⚠️ FORMAL REVIEW REQUIRED - You have reached 6+ points. A formal review meeting will be scheduled.`;
  } else if (points >= 4) {
    message += `⚠️ AT RISK - You're approaching the 6-point threshold. Need support? Reply "YES" to talk to your supervisor.`;
  } else if (points >= 3) {
    message += `⚠️ WATCH - Please be mindful of attendance.`;
  } else {
    message += `✅ Good standing.`;
  }

  if (parsedData.expected_return) {
    message += ` See you ${parsedData.expected_return}.`;
  }

  return message;
};

module.exports = exports;
