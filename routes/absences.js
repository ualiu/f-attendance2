const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../middleware/auth');
const { scopeQuery, validateTenantAccess } = require('../utils/tenantHelper');
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');

// All absence routes require authentication + tenant scoping
router.use(requireTenantAuth);

// Get absence details
router.get('/:id/details', async (req, res) => {
  try {
    const absence = await validateTenantAccess(Absence, req.params.id, req.organizationId);
    await absence.populate('employee_id');

    res.json({ success: true, absence });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent reports (with pagination)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50; // Default 50 per page
    const skip = (page - 1) * limit;
    const { employee_id } = req.query;

    const query = {};
    if (employee_id) {
      query.employee_id = employee_id;
    }

    const scopedQuery = scopeQuery(req.organizationId, query);

    // Get total count for pagination metadata
    const total = await Absence.countDocuments(scopedQuery);

    const absences = await Absence.find(scopedQuery)
      .populate('employee_id')
      .sort({ report_time: -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      absences,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific absence/call by ID
router.get('/:id', async (req, res) => {
  try {
    const absence = await validateTenantAccess(Absence, req.params.id, req.organizationId);
    await absence.populate('employee_id');

    res.json({ success: true, absence });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create manual absence (admin only)
router.post('/', async (req, res) => {
  try {
    const { employee_id, type, reason, date } = req.body;

    // Validate required fields
    if (!employee_id || !type || !reason) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: employee_id, type, reason'
      });
    }

    // Validate employee belongs to organization
    const employee = await validateTenantAccess(Employee, employee_id, req.organizationId);

    // Create absence record
    const absence = await Absence.create({
      employee_id: employee._id,
      employee_name: employee.name,
      organization_id: req.organizationId,
      date: date ? new Date(date) : new Date(),
      type,
      reason,
      report_time: new Date(),
      report_method: 'manual',
      report_message: null,
      late_notice: false
    });

    console.log(`✅ MANUAL ABSENCE LOGGED:`);
    console.log(`   Employee: ${employee.name}`);
    console.log(`   Type: ${type}`);
    console.log(`   Reason: ${reason}`);
    console.log(`   Logged by: ${req.user.name || req.user.email}`);

    res.json({
      success: true,
      absence,
      message: 'Absence logged successfully'
    });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    console.error('Error creating manual absence:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint - check database status (tenant-scoped)
router.get('/debug/status', async (req, res) => {
  try {
    const absenceCount = await Absence.countDocuments(scopeQuery(req.organizationId));
    const employeeCount = await Employee.countDocuments(scopeQuery(req.organizationId));

    const recentAbsences = await Absence.find(scopeQuery(req.organizationId))
      .sort({ created_at: -1 })
      .limit(10)
      .lean();

    const employees = await Employee.find(scopeQuery(req.organizationId)).lean();

    res.json({
      success: true,
      database: 'Connected',
      counts: {
        absences: absenceCount,
        employees: employeeCount
      },
      recentAbsences: recentAbsences.map(a => ({
        id: a._id,
        employee: a.employee_name,
        type: a.type,
        reason: a.reason,
        report_time: a.report_time,
        report_method: a.report_method,
        created_at: a.created_at
      })),
      employees: employees.map(e => ({
        id: e._id,
        name: e.name,
        phone: e.phone,
        shift: e.shift
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
