const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../middleware/auth');
const { scopeQuery } = require('../utils/tenantHelper');
const claudeService = require('../services/claudeService');
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');

// All report routes require authentication + tenant scoping
router.use(requireTenantAuth);

// Main reports page with date filtering
router.get('/', async (req, res) => {
  try {
    const { range = 'week', startDate, endDate, employee, type } = req.query;

    // Calculate date range
    let start, end;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (startDate && endDate) {
      // Custom date range
      start = new Date(startDate);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    } else {
      // Preset ranges
      switch (range) {
        case 'today':
          start = new Date(today);
          end = new Date(today);
          end.setHours(23, 59, 59, 999);
          break;
        case 'week':
          start = new Date(today);
          start.setDate(today.getDate() - 7);
          end = new Date(today);
          end.setHours(23, 59, 59, 999);
          break;
        case 'month':
          start = new Date(today.getFullYear(), today.getMonth(), 1);
          end = new Date(today);
          end.setHours(23, 59, 59, 999);
          break;
        case 'quarter':
          const quarterStart = Math.floor(today.getMonth() / 3) * 3;
          start = new Date(today.getFullYear(), quarterStart, 1);
          end = new Date(today);
          end.setHours(23, 59, 59, 999);
          break;
        case 'year':
          start = new Date(today.getFullYear(), 0, 1);
          end = new Date(today);
          end.setHours(23, 59, 59, 999);
          break;
        default:
          start = new Date(today);
          start.setDate(today.getDate() - 7);
          end = new Date(today);
          end.setHours(23, 59, 59, 999);
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

    // Calculate statistics
    const stats = {
      total: absences.length,
      sick: absences.filter(a => a.type === 'sick').length,
      personal: absences.filter(a => a.type === 'personal').length,
      late: absences.filter(a => a.type === 'late').length
    };

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
