const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const WorkStation = require('../models/WorkStation');

// Get the start of the current quarter
const getQuarterStart = () => {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  if (month < 3) return new Date(year, 0, 1); // Jan 1
  if (month < 6) return new Date(year, 3, 1); // Apr 1
  if (month < 9) return new Date(year, 6, 1); // Jul 1
  return new Date(year, 9, 1); // Oct 1
};

// Calculate points for an employee
exports.calculatePoints = async (employeeId) => {
  const quarterStart = getQuarterStart();

  const absences = await Absence.find({
    employee_id: employeeId,
    date: { $gte: quarterStart },
    type: { $in: ['sick', 'personal'] } // Exclude approved PTO
  });

  const tardies = await Absence.find({
    employee_id: employeeId,
    date: { $gte: quarterStart },
    type: 'late'
  });

  const absencePoints = absences.length;
  const tardyPoints = Math.floor(tardies.length / 3);

  return absencePoints + tardyPoints;
};

// Get attendance status based on points
exports.getStatus = (points) => {
  if (points >= 6) return 'review_required';
  if (points >= 4) return 'at_risk';
  if (points >= 3) return 'watch';
  return 'good';
};

// Update employee attendance stats
exports.updateEmployeeStats = async (employeeId) => {
  const quarterStart = getQuarterStart();

  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error('Employee not found');
  }

  // Count absences
  const absences = await Absence.countDocuments({
    employee_id: employeeId,
    date: { $gte: quarterStart },
    type: { $in: ['sick', 'personal'] }
  });

  // Count tardies
  const tardies = await Absence.countDocuments({
    employee_id: employeeId,
    date: { $gte: quarterStart },
    type: 'late'
  });

  // Calculate points
  const points = await this.calculatePoints(employeeId);
  const status = this.getStatus(points);

  // Update employee
  employee.points_current_quarter = points;
  employee.absences_this_quarter = absences;
  employee.tardies_this_quarter = tardies;
  employee.status = status;

  await employee.save();

  return employee;
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

// Check work station impact
exports.checkStationImpact = async (workStationName) => {
  if (!workStationName) {
    return { impacted: false };
  }

  const station = await WorkStation.findOne({ name: workStationName })
    .populate('primary_worker backup_workers');

  if (!station) {
    return { impacted: false };
  }

  const hasBackup = station.backup_workers && station.backup_workers.length > 0;
  const isCritical = station.required_for_production;

  return {
    impacted: isCritical,
    hasBackup,
    isCritical,
    station,
    urgency: isCritical && !hasBackup ? 'high' : 'normal'
  };
};

// Calculate points to award for an absence
exports.calculatePointsToAward = (absenceType) => {
  switch (absenceType) {
    case 'sick':
    case 'personal':
      return 1.0;
    case 'late':
      return 0.33;
    case 'approved_pto':
      return 0.0;
    default:
      return 1.0;
  }
};

// Get today's attendance summary
exports.getTodaysSummary = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todaysAbsences = await Absence.find({
    date: { $gte: today, $lt: tomorrow }
  }).populate('employee_id');

  const totalEmployees = await Employee.countDocuments();
  const absentCount = todaysAbsences.filter(a => a.type !== 'late').length;
  const lateCount = todaysAbsences.filter(a => a.type === 'late').length;
  const presentCount = totalEmployees - absentCount;

  return {
    totalEmployees,
    presentCount,
    absentCount,
    lateCount,
    absences: todaysAbsences
  };
};

// Get employees at risk
exports.getAtRiskEmployees = async () => {
  return await Employee.find({
    status: { $in: ['at_risk', 'review_required'] }
  }).sort({ points_current_quarter: -1 });
};

// Get affected stations today
exports.getAffectedStationsToday = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const todaysAbsences = await Absence.find({
    date: { $gte: today, $lt: tomorrow },
    type: { $ne: 'late' }
  }).populate('employee_id');

  const stationNames = [...new Set(todaysAbsences.map(a => a.work_station))];

  const stations = await WorkStation.find({
    name: { $in: stationNames }
  }).populate('primary_worker backup_workers');

  return stations.map(station => {
    const absencesForStation = todaysAbsences.filter(a => a.work_station === station.name);
    return {
      ...station.toObject(),
      absences: absencesForStation,
      status: station.required_for_production && station.backup_workers.length === 0 ? 'critical' : 'affected'
    };
  });
};

module.exports = exports;
