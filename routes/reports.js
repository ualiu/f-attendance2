const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../middleware/auth');
const { scopeQuery } = require('../utils/tenantHelper');
const claudeService = require('../services/claudeService');
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');
const Organization = require('../models/Organization');

// All report routes require authentication + tenant scoping
router.use(requireTenantAuth);

// Main reports page with date filtering
router.get('/', async (req, res) => {
  try {
    const { range = 'week', startDate, endDate, employee, type } = req.query;

    // Calculate date range (use UTC to avoid timezone issues)
    let start, end;
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();
    const today = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

    if (startDate && endDate) {
      // Custom date range
      start = new Date(startDate);
      end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
    } else {
      // Preset ranges
      switch (range) {
        case 'today':
          start = new Date(today);
          end = new Date(today);
          end.setUTCHours(23, 59, 59, 999);
          break;
        case 'week':
          start = new Date(today);
          start.setUTCDate(today.getUTCDate() - 7);
          end = new Date(today);
          end.setUTCHours(23, 59, 59, 999);
          break;
        case 'month':
          start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
          end = new Date(today);
          end.setUTCHours(23, 59, 59, 999);
          break;
        case 'quarter':
          const quarterStart = Math.floor(month / 3) * 3;
          start = new Date(Date.UTC(year, quarterStart, 1, 0, 0, 0, 0));
          end = new Date(today);
          end.setUTCHours(23, 59, 59, 999);
          break;
        case 'year':
          start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
          end = new Date(today);
          end.setUTCHours(23, 59, 59, 999);
          break;
        default:
          start = new Date(today);
          start.setUTCDate(today.getUTCDate() - 7);
          end = new Date(today);
          end.setUTCHours(23, 59, 59, 999);
      }
    }

    // Build query
    const query = scopeQuery(req.organizationId, {
      date: { $gte: start, $lte: end }
    });

    if (employee) query.employee_id = employee;
    if (type) query.type = type;

    // Get absences
    const absences = await Absence.find(query)
      .populate('employee_id')
      .sort({ date: -1 });

    // Get all employees for filter dropdown
    const employees = await Employee.find(scopeQuery(req.organizationId))
      .sort({ name: 1 });

    // Get organization settings for shift times
    const organization = await Organization.findById(req.organizationId);
    const shiftTimes = organization?.settings?.shift_times || {
      day_start: '07:00',
      day_end: '15:00',
      night_start: '19:00',
      night_end: '03:00',
      weekend_start: '08:00',
      weekend_end: '16:00'
    };

    // Helper function to calculate shift duration in hours
    function calculateShiftHours(startTime, endTime) {
      const [startHour, startMin] = startTime.split(':').map(Number);
      const [endHour, endMin] = endTime.split(':').map(Number);

      let startMinutes = startHour * 60 + startMin;
      let endMinutes = endHour * 60 + endMin;

      // Handle overnight shifts (e.g., 19:00 to 03:00)
      if (endMinutes < startMinutes) {
        endMinutes += 24 * 60; // Add 24 hours
      }

      return (endMinutes - startMinutes) / 60;
    }

    // Pre-calculate shift durations
    const shiftDurations = {
      'Day': calculateShiftHours(shiftTimes.day_start, shiftTimes.day_end),
      'Night': calculateShiftHours(shiftTimes.night_start, shiftTimes.night_end),
      'Weekend': calculateShiftHours(shiftTimes.weekend_start, shiftTimes.weekend_end)
    };

    // Calculate manpower hours lost
    let totalHoursLost = 0;

    for (const absence of absences) {
      // Get employee to determine shift
      const employee = await Employee.findById(absence.employee_id);
      if (!employee || !employee.shift) continue;

      if (absence.type === 'late') {
        // For lates: use stored duration or estimate from report time vs shift start
        let lateMinutes = absence.late_duration_minutes;

        if (!lateMinutes && absence.report_time) {
          // Estimate: calculate how late they were based on shift start time
          const reportTime = new Date(absence.report_time);
          const reportHour = reportTime.getHours();
          const reportMin = reportTime.getMinutes();
          const reportTotalMinutes = reportHour * 60 + reportMin;

          // Get shift start time
          let shiftStartTime;
          if (employee.shift === 'Day') {
            shiftStartTime = shiftTimes.day_start;
          } else if (employee.shift === 'Night') {
            shiftStartTime = shiftTimes.night_start;
          } else if (employee.shift === 'Weekend') {
            shiftStartTime = shiftTimes.weekend_start;
          }

          if (shiftStartTime) {
            const [startHour, startMin] = shiftStartTime.split(':').map(Number);
            const shiftStartMinutes = startHour * 60 + startMin;
            lateMinutes = Math.max(0, reportTotalMinutes - shiftStartMinutes);
          }
        }

        // Default to 30 minutes if we still can't determine
        if (!lateMinutes || lateMinutes <= 0) {
          lateMinutes = 30;
        }

        // Add late hours (convert minutes to hours)
        totalHoursLost += lateMinutes / 60;
      } else {
        // For full absences: count entire shift
        const shiftDuration = shiftDurations[employee.shift] || 8;
        totalHoursLost += shiftDuration;
      }
    }

    // Calculate statistics
    const stats = {
      total: absences.length,
      sick: absences.filter(a => a.type === 'sick').length,
      personal: absences.filter(a => a.type === 'personal').length,
      late: absences.filter(a => a.type === 'late').length,
      hoursLost: Math.round(totalHoursLost * 10) / 10 // Round to 1 decimal place
    };

    // Group by employee for chart (employee name -> count by type)
    const byEmployee = {};
    absences.forEach(absence => {
      const empName = absence.employee_name;
      if (!byEmployee[empName]) {
        byEmployee[empName] = {
          total: 0,
          lates: 0,
          absences: 0
        };
      }
      byEmployee[empName].total++;

      // Categorize: Lates vs Absences
      if (absence.type === 'late') {
        byEmployee[empName].lates++;
      } else {
        // Everything else is an absence (sick, personal, manual incidents)
        byEmployee[empName].absences++;
      }
    });

    // Convert to sorted array for chart
    const employeeChartData = Object.entries(byEmployee)
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.total - a.total); // Sort by total absences descending

    // Group by date for timeline
    const byDate = {};
    absences.forEach(absence => {
      const dateKey = absence.date.toISOString().split('T')[0];
      if (!byDate[dateKey]) {
        byDate[dateKey] = [];
      }
      byDate[dateKey].push(absence);
    });

    res.render('reports/index', {
      title: 'Absence Reports',
      absences,
      employees,
      stats,
      byDate,
      employeeChartData,
      filters: {
        range,
        startDate: start.toISOString().split('T')[0],
        endDate: end.toISOString().split('T')[0],
        employee: employee || '',
        type: type || ''
      }
    });
  } catch (error) {
    console.error('Error loading reports:', error);
    res.status(500).send('Error loading reports: ' + error.message);
  }
});

// Generate individual employee report (used from employee profile page)
router.get('/employee', async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;

    // Default to current quarter if no dates provided
    const today = new Date();
    const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    const quarterEnd = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 0);

    const finalStartDate = startDate ? new Date(startDate) : quarterStart;
    const finalEndDate = endDate ? new Date(endDate) : quarterEnd;

    if (!employeeId) {
      return res.status(400).send('Employee ID is required');
    }

    const report = await claudeService.generateEmployeeReport(
      employeeId,
      finalStartDate,
      finalEndDate,
      req.organizationId
    );

    res.render('reports/employee-report', {
      title: 'Employee Report',
      report,
      startDate: finalStartDate.toISOString().split('T')[0],
      endDate: finalEndDate.toISOString().split('T')[0]
    });
  } catch (error) {
    console.error('Error generating employee report:', error);
    res.status(500).send('Error generating report: ' + error.message);
  }
});

module.exports = router;
