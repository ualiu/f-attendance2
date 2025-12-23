const Employee = require('../models/Employee');
const Absence = require('../models/Absence');

// Helper to scope queries by organization
const scopeQuery = (organizationId, baseQuery = {}) => {
  if (!organizationId) {
    throw new Error('organizationId is required for scoped queries');
  }
  return { ...baseQuery, organization_id: organizationId };
};

// Check if notice was given in time (30 minutes before shift)
exports.checkNoticeTime = (employee, callTime, organization) => {
  const shiftStart = this.getShiftStartTime(employee.shift, organization);
  const minutesBeforeShift = (shiftStart - callTime) / 60000;

  return {
    isLateNotice: minutesBeforeShift < 30,
    minutesBeforeShift: Math.round(minutesBeforeShift)
  };
};

// Get shift start time for today using organization's configured shift times
exports.getShiftStartTime = (shift, organization) => {
  const today = new Date();
  today.setSeconds(0);
  today.setMilliseconds(0);

  // Get configured shift times from organization, or use defaults
  const shiftTimes = organization?.settings?.shift_times || {
    day_start: '07:00',
    night_start: '19:00',
    weekend_start: '08:00'
  };

  let startTime;
  if (shift === 'Day') {
    startTime = shiftTimes.day_start;
  } else if (shift === 'Night') {
    startTime = shiftTimes.night_start;
  } else if (shift === 'Weekend') {
    startTime = shiftTimes.weekend_start;
  } else {
    // Fallback for any legacy shift names
    startTime = '07:00';
  }

  // Parse HH:MM format
  const [hours, minutes] = startTime.split(':').map(Number);
  today.setHours(hours, minutes, 0);

  return today;
};

// Get today's attendance summary
exports.getTodaysSummary = async (organizationId) => {
  // Use UTC midnight to avoid timezone issues
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const day = today.getUTCDate();
  const todayUTC = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

  const tomorrow = new Date(todayUTC);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const todaysAbsences = await Absence.find(scopeQuery(organizationId, {
    date: { $gte: todayUTC, $lt: tomorrow }
  })).populate('employee_id');

  const totalEmployees = await Employee.countDocuments(scopeQuery(organizationId));

  // Count unique employees (not total records) to handle multiple absences per employee
  const uniqueEmployeesWithAbsences = new Set();
  const uniqueLateEmployees = new Set();
  const uniqueAbsentEmployees = new Set();

  todaysAbsences.forEach(absence => {
    const empId = absence.employee_id?._id?.toString() || absence.employee_id?.toString();
    if (empId) {
      uniqueEmployeesWithAbsences.add(empId);

      if (absence.type === 'late') {
        uniqueLateEmployees.add(empId);
      } else {
        uniqueAbsentEmployees.add(empId);
      }
    }
  });

  const absentCount = uniqueAbsentEmployees.size;
  const lateCount = uniqueLateEmployees.size;
  const presentCount = Math.max(0, totalEmployees - absentCount - lateCount); // Prevent negative

  return {
    totalEmployees,
    presentCount,
    absentCount,
    lateCount,
    absences: todaysAbsences
  };
};

module.exports = exports;
