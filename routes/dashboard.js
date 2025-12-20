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

    // Get employees at risk (tenant-scoped)
    const alertEmployees = await attendanceService.getAtRiskEmployees(req.organizationId);

    // Get recent absence reports (last 10, tenant-scoped)
    const recentAbsences = await Absence.find(scopeQuery(req.organizationId))
      .populate('employee_id')
      .sort({ report_time: -1 })
      .limit(10);

    res.render('dashboard/index', {
      title: 'Dashboard',
      todaysSummary,
      alertEmployees,
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

    // Get all absences for this quarter
    const quarterStart = new Date();
    const month = quarterStart.getMonth();
    if (month < 3) quarterStart.setMonth(0, 1);
    else if (month < 6) quarterStart.setMonth(3, 1);
    else if (month < 9) quarterStart.setMonth(6, 1);
    else quarterStart.setMonth(9, 1);
    quarterStart.setHours(0, 0, 0, 0);

    const absences = await Absence.find(scopeQuery(req.organizationId, {
      employee_id: employee._id,
      date: { $gte: quarterStart }
    })).sort({ date: -1 });

    res.render('dashboard/employee', {
      title: `Employee: ${employee.name}`,
      employee,
      absences,
      quarterStart
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
    const alertEmployees = await attendanceService.getAtRiskEmployees(req.organizationId);

    res.json({
      success: true,
      todaysSummary,
      alertEmployees
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
