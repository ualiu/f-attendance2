const Employee = require('../models/Employee');
const attendanceService = require('./attendanceService');

// Vapi assistant system prompt
const SYSTEM_PROMPT = `You are an AI attendance assistant for Felton Brushes manufacturing.

COMPANY POLICY:
- 6 absences in 90 days = formal review required
- 8 absences = termination review
- 3 tardies (>15min late) = 1 absence
- 30 minutes advance notice required

YOUR JOB:
1. Greet employee warmly by name
2. Confirm their work station
3. Ask reason for calling (sick/late)
4. Capture details (reason, expected return)
5. Tell them their current points status
6. If at 4-5 points: Proactively offer help/coaching
7. If at 6+ points: Inform formal review required
8. Always be supportive, non-judgmental

TONE: Professional, supportive, clear about policies

IMPORTANT: You must call the appropriate function to log the absence or tardy.`;

// Get employee by phone number
exports.getEmployeeByPhone = async (phone) => {
  // Normalize phone number (remove +1, spaces, dashes, etc.)
  const normalizedPhone = phone.replace(/[\s\-\(\)\+]/g, '');

  const employee = await Employee.findOne({
    phone: { $regex: normalizedPhone }
  });

  return employee;
};

// Get employee by name
exports.getEmployeeByName = async (name) => {
  const employee = await Employee.findOne({
    name: { $regex: new RegExp(name, 'i') }
  });

  return employee;
};

// Function definitions for Vapi AI assistant
exports.vapiFunction = {
  // Get employee record
  get_employee_record: async (params) => {
    const { phone, name } = params;

    let employee;
    if (phone) {
      employee = await exports.getEmployeeByPhone(phone);
    } else if (name) {
      employee = await exports.getEmployeeByName(name);
    }

    if (!employee) {
      return {
        success: false,
        message: 'Employee not found'
      };
    }

    return {
      success: true,
      employee: {
        name: employee.name,
        employee_id: employee.employee_id,
        work_station: employee.work_station,
        shift: employee.shift,
        points: employee.points_current_quarter,
        status: employee.status,
        absences: employee.absences_this_quarter,
        tardies: employee.tardies_this_quarter
      }
    };
  },

  // Log absence
  log_absence: async (params) => {
    const { employee_id, type, reason, expected_return, work_station } = params;

    try {
      const Employee = require('../models/Employee');
      const Absence = require('../models/Absence');
      const attendanceService = require('./attendanceService');

      // Find employee
      const employee = await Employee.findOne({ employee_id });

      if (!employee) {
        return {
          success: false,
          message: 'Employee not found'
        };
      }

      // Calculate points
      const pointsAwarded = attendanceService.calculatePointsToAward(type);

      // Check notice time
      const callTime = new Date();
      const noticeCheck = attendanceService.checkNoticeTime(employee, callTime);

      // Check station impact
      const stationImpact = await attendanceService.checkStationImpact(work_station || employee.work_station);

      // Create absence record
      const absence = await Absence.create({
        employee_id: employee._id,
        employee_name: employee.name,
        work_station: work_station || employee.work_station,
        date: new Date(),
        type,
        reason,
        expected_return: expected_return ? new Date(expected_return) : null,
        call_time: callTime,
        call_duration: 0,
        call_transcript: null, // Will be updated by webhook
        points_awarded: pointsAwarded,
        late_notice: noticeCheck.isLateNotice,
        station_impacted: stationImpact.impacted
      });

      console.log(`✅ ABSENCE SAVED TO DATABASE:`);
      console.log(`   ID: ${absence._id}`);
      console.log(`   Employee: ${employee.name} (${employee._id})`);
      console.log(`   Type: ${type}`);
      console.log(`   Reason: ${reason}`);
      console.log(`   Call Time: ${callTime}`);
      console.log(`   Points: ${pointsAwarded}`);

      // Update employee stats
      await attendanceService.updateEmployeeStats(employee._id);

      console.log(`✅ Employee stats updated for ${employee.name}`);

      return {
        success: true,
        message: `Logged. Absence recorded for ${employee.name}.`,
        points_added: pointsAwarded,
        total_points: employee.points_current_quarter + pointsAwarded
      };
    } catch (error) {
      console.error('Error logging absence:', error);
      return {
        success: false,
        message: 'Error logging absence: ' + error.message
      };
    }
  },

  // Log tardy
  log_tardy: async (params) => {
    const { employee_id, minutes_late, reason } = params;

    try {
      const Employee = require('../models/Employee');
      const Absence = require('../models/Absence');
      const attendanceService = require('./attendanceService');

      const employee = await Employee.findOne({ employee_id });

      if (!employee) {
        return {
          success: false,
          message: 'Employee not found'
        };
      }

      const callTime = new Date();
      const noticeCheck = attendanceService.checkNoticeTime(employee, callTime);

      const absence = await Absence.create({
        employee_id: employee._id,
        employee_name: employee.name,
        work_station: employee.work_station,
        date: new Date(),
        type: 'late',
        reason: `${minutes_late} minutes late - ${reason}`,
        call_time: callTime,
        call_duration: 0,
        call_transcript: null,
        points_awarded: 0.33,
        late_notice: noticeCheck.isLateNotice
      });

      console.log(`✅ TARDY SAVED TO DATABASE:`);
      console.log(`   ID: ${absence._id}`);
      console.log(`   Employee: ${employee.name} (${employee._id})`);
      console.log(`   Minutes Late: ${minutes_late}`);
      console.log(`   Call Time: ${callTime}`);

      await attendanceService.updateEmployeeStats(employee._id);

      console.log(`✅ Employee stats updated for ${employee.name}`);

      return {
        success: true,
        message: `Logged. Tardy recorded for ${employee.name}.`,
        points_added: 0.33,
        total_points: employee.points_current_quarter + 0.33
      };
    } catch (error) {
      console.error('Error logging tardy:', error);
      return {
        success: false,
        message: 'Error logging tardy: ' + error.message
      };
    }
  },

  // Check threshold status
  check_threshold_status: async (params) => {
    const { employee_id } = params;

    const employee = await Employee.findOne({ employee_id });

    if (!employee) {
      return {
        success: false,
        message: 'Employee not found'
      };
    }

    const points = employee.points_current_quarter;
    const status = employee.status;

    let message = '';
    let coaching_needed = false;

    if (points >= 6) {
      message = 'FORMAL REVIEW REQUIRED - You have reached 6 or more points. A formal review meeting will be scheduled.';
      coaching_needed = true;
    } else if (points >= 4) {
      message = `AT RISK - You currently have ${points} points. You are approaching the threshold of 6 points which triggers a formal review.`;
      coaching_needed = true;
    } else if (points >= 3) {
      message = `WATCH - You currently have ${points} points. Please be mindful of attendance to avoid formal review.`;
    } else {
      message = `GOOD STANDING - You currently have ${points} points.`;
    }

    return {
      success: true,
      points,
      status,
      message,
      coaching_needed
    };
  }
};

// Create Vapi assistant configuration
exports.createAssistantConfig = () => {
  return {
    name: 'Felton Brushes Attendance Assistant',
    firstMessage: 'Hi, this is the Felton Brushes attendance line. Who am I speaking with?',
    model: {
      provider: 'openai',
      model: 'gpt-4',
      temperature: 0.7,
      systemPrompt: SYSTEM_PROMPT
    },
    voice: {
      provider: 'playht',
      voiceId: 'jennifer' // Professional female voice
    },
    functions: [
      {
        name: 'get_employee_record',
        description: 'Look up employee by phone number or name',
        parameters: {
          type: 'object',
          properties: {
            phone: {
              type: 'string',
              description: 'Employee phone number'
            },
            name: {
              type: 'string',
              description: 'Employee name'
            }
          }
        }
      },
      {
        name: 'log_absence',
        description: 'Log an employee absence (sick day or personal day)',
        parameters: {
          type: 'object',
          properties: {
            employee_id: {
              type: 'string',
              description: 'Employee ID'
            },
            type: {
              type: 'string',
              enum: ['sick', 'personal', 'approved_pto'],
              description: 'Type of absence'
            },
            reason: {
              type: 'string',
              description: 'Reason for absence'
            },
            expected_return: {
              type: 'string',
              description: 'Expected return date (YYYY-MM-DD)'
            },
            work_station: {
              type: 'string',
              description: 'Work station name'
            }
          },
          required: ['employee_id', 'type', 'reason', 'work_station']
        }
      },
      {
        name: 'log_tardy',
        description: 'Log an employee tardy (late arrival)',
        parameters: {
          type: 'object',
          properties: {
            employee_id: {
              type: 'string',
              description: 'Employee ID'
            },
            minutes_late: {
              type: 'number',
              description: 'How many minutes late'
            },
            reason: {
              type: 'string',
              description: 'Reason for being late'
            }
          },
          required: ['employee_id', 'minutes_late', 'reason']
        }
      },
      {
        name: 'check_threshold_status',
        description: 'Check if employee is approaching or at attendance threshold',
        parameters: {
          type: 'object',
          properties: {
            employee_id: {
              type: 'string',
              description: 'Employee ID'
            }
          },
          required: ['employee_id']
        }
      }
    ]
  };
};

// Update assistant via VAPI API
exports.updateAssistant = async (assistantId, updates) => {
  const VAPI_API_KEY = process.env.VAPI_API_KEY;

  if (!VAPI_API_KEY) {
    throw new Error('VAPI_API_KEY not set in environment variables');
  }

  try {
    const response = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      throw new Error(`VAPI API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating VAPI assistant:', error);
    throw error;
  }
};

// Example: Update system prompt based on business rules
exports.updateAttendancePolicy = async (assistantId, newPolicy) => {
  const newPrompt = `You are an AI attendance assistant for Felton Brushes manufacturing.

COMPANY POLICY (UPDATED):
${newPolicy}

YOUR JOB:
1. Greet employee warmly by name
2. Confirm their work station
3. Ask reason for calling (sick/late)
4. Capture details (reason, expected return)
5. Tell them their current points status
6. If at 4-5 points: Proactively offer help/coaching
7. If at 6+ points: Inform formal review required
8. Always be supportive, non-judgmental

TONE: Professional, supportive, clear about policies

IMPORTANT: You must call the appropriate function to log the absence or tardy.`;

  return await exports.updateAssistant(assistantId, {
    model: {
      systemPrompt: newPrompt
    }
  });
};

// Start a Vapi call
exports.startCall = async (phoneNumber, employeeContext = null) => {
  // In production, this would call the Vapi API to initiate a call
  // For now, this is a placeholder

  const assistantConfig = exports.createAssistantConfig();

  // If we have employee context, add it to the first message
  if (employeeContext) {
    assistantConfig.firstMessage = `Hi ${employeeContext.name}, this is the Felton Brushes attendance line. How can I help you today?`;
  }

  return {
    success: true,
    message: 'Call initiated',
    config: assistantConfig
  };
};

module.exports = exports;
