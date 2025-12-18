const Anthropic = require('@anthropic-ai/sdk');
const Absence = require('../models/Absence');
const attendanceService = require('./attendanceService');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Parse attendance message using Claude
exports.parseAttendanceMessage = async (messageBody, employee) => {
  try {
    const prompt = `You are an attendance parser for Felton Brushes manufacturing company.

Employee: ${employee.name}
Current Points: ${employee.points_current_quarter}
Work Station: ${employee.work_station}
Shift: ${employee.shift}

Parse this attendance message and extract structured data:
"${messageBody}"

Be SMART about interpreting natural language:
- "Can't come in" / "Won't be in" / "Not coming" → Assume SICK unless they specify otherwise
- "Running late" / "Gonna be late" → Type is LATE
- "Personal day" / "Need the day off" → Type is PERSONAL
- If they don't give a reason, infer one from context

Determine:
1. Type: "sick", "late", "personal", or "unclear"
2. Reason: Brief description (infer if not explicitly stated)
3. Expected return: If they mention when they'll be back (format: YYYY-MM-DD, or null)
4. Minutes late: If type is "late", how many minutes (number, or null)
5. Needs clarification: true if message is too vague to determine type

Examples:
- "I'm sick today" → type: sick, reason: "Feeling sick", needs_clarification: false
- "Can't come in today" → type: sick, reason: "Unable to come in", needs_clarification: false
- "Not feeling well" → type: sick, reason: "Not feeling well", needs_clarification: false
- "Running 30 min late, traffic" → type: late, minutes_late: 30, reason: "Traffic", needs_clarification: false
- "Taking a personal day" → type: personal, reason: "Personal day", needs_clarification: false
- "Won't be there" → type: sick, reason: "Absent", needs_clarification: false
- "Hey" → type: unclear, needs_clarification: true

Respond ONLY with valid JSON:
{
  "type": "sick|late|personal|unclear",
  "reason": "string",
  "expected_return": "YYYY-MM-DD or null",
  "minutes_late": number or null,
  "needs_clarification": boolean
}`;

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
    const responseText = message.content[0].text;
    console.log('   🤖 Claude response:', responseText);

    // Parse JSON response
    const parsed = JSON.parse(responseText);

    // Check if needs clarification
    if (parsed.needs_clarification || parsed.type === 'unclear') {
      return {
        success: false,
        needs_clarification: true,
        error: 'Message too vague'
      };
    }

    // Validate
    if (!parsed.type || !['sick', 'late', 'personal'].includes(parsed.type)) {
      return {
        success: false,
        needs_clarification: true,
        error: 'Invalid type'
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
      call_time: callTime,
      call_duration: 0,
      call_transcript: originalMessage, // Store original SMS text
      call_recording_url: null,
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
