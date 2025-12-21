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
exports.checkNoticeTime = (employee, callTime) => {
  const shiftStart = this.getShiftStartTime(employee.shift);
  const minutesBeforeShift = (shiftStart - callTime) / 60000;

  return {
    isLateNotice: minutesBeforeShift < 30,
    minutesBeforeShift: Math.round(minutesBeforeShift)
  };
};

// Get shift start time for today
exports.getShiftStartTime = (shift) => {
  const today = new Date();
  today.setSeconds(0);
  today.setMilliseconds(0);

  if (shift === 'Day (7am-3:30pm)') {
    today.setHours(7, 0, 0);
  } else if (shift === 'Afternoon (3:30pm-12am)') {
    today.setHours(15, 30, 0);
  } else if (shift === 'Night (12am-7am)') {
    today.setHours(0, 0, 0);
  }

  return today;
};

// Get today's attendance summary
exports.getTodaysSummary = async (organizationId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todaysAbsences = await Absence.find(scopeQuery(organizationId, {
    date: { $gte: today, $lt: tomorrow }
  })).populate('employee_id');

  const totalEmployees = await Employee.countDocuments(scopeQuery(organizationId));
  const absentCount = todaysAbsences.filter(a => a.type !== 'late').length;
  const lateCount = todaysAbsences.filter(a => a.type === 'late').length;
  const presentCount = totalEmployees - absentCount - lateCount;

  return {
    totalEmployees,
    presentCount,
    absentCount,
    lateCount,
    absences: todaysAbsences
  };
};

module.exports = exports;
