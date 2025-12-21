const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../middleware/auth');
const { scopeQuery, validateTenantAccess } = require('../utils/tenantHelper');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const attendanceService = require('../services/attendanceService');

// All dashboard routes require authentication + tenant scoping
router.use(requireTenantAuth);

// Main dashboard
router.get('/', async (req, res) => {
  try {
    // Get today's summary (tenant-scoped)
    const todaysSummary = await attendanceService.getTodaysSummary(req.organizationId);

    // Get recent absence reports (last 10, tenant-scoped)
    const recentAbsences = await Absence.find(scopeQuery(req.organizationId))
      .populate('employee_id')
      .sort({ report_time: -1 })
      .limit(10);

    res.render('dashboard/index', {
      title: 'Dashboard',
      todaysSummary,
      recentAbsences
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    res.status(500).send('Server error');
  }
});

// Employee detail view
router.get('/employee/:id', async (req, res) => {
  try {
    // Validate employee belongs to organization
    const employee = await validateTenantAccess(Employee, req.params.id, req.organizationId);
    await employee.populate('supervisor_id');

    // Get date range from query params or default to current quarter
    let startDate, endDate;
    const { start, end } = req.query;

    if (start && end) {
      // Custom date range
      startDate = new Date(start);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Default to current quarter
      startDate = new Date();
      const month = startDate.getMonth();
      if (month < 3) startDate.setMonth(0, 1);
      else if (month < 6) startDate.setMonth(3, 1);
      else if (month < 9) startDate.setMonth(6, 1);
      else startDate.setMonth(9, 1);
      startDate.setHours(0, 0, 0, 0);

      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    }

    const absences = await Absence.find(scopeQuery(req.organizationId, {
      employee_id: employee._id,
      date: { $gte: startDate, $lte: endDate }
    })).sort({ date: -1 });

    res.render('dashboard/employee', {
      title: `Employee: ${employee.name}`,
      employee,
      absences,
      startDate,
      endDate
    });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).send('Employee not found');
    }
    console.error('Error loading employee:', error);
    res.status(500).send('Server error');
  }
});

// API endpoint: Get dashboard data (for AJAX updates)
router.get('/api/data', async (req, res) => {
  try {
    const todaysSummary = await attendanceService.getTodaysSummary(req.organizationId);

    res.json({
      success: true,
      todaysSummary
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
