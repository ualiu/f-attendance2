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
