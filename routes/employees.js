const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../middleware/auth');
const { scopeQuery, validateTenantAccess } = require('../utils/tenantHelper');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const attendanceService = require('../services/attendanceService');

// All employee routes require authentication + tenant scoping
router.use(requireTenantAuth);

// Get all employees (tenant-scoped)
router.get('/', async (req, res) => {
  try {
    const employees = await Employee.find(scopeQuery(req.organizationId))
      .populate('supervisor_id')
      .sort({ name: 1 });

    res.json({ success: true, employees });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single employee (tenant-scoped)
router.get('/:id', async (req, res) => {
  try {
    const employee = await validateTenantAccess(Employee, req.params.id, req.organizationId);
    await employee.populate('supervisor_id');

    res.json({ success: true, employee });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create employee (tenant-scoped)
router.post('/', async (req, res) => {
  try {
    const { employee_id, name, phone, shift } = req.body;

    // Assign supervisor if authenticated user is a supervisor
    const supervisor_id = req.user._id;

    const employee = await Employee.create({
      employee_id,
      name,
      phone,
      shift,
      supervisor_id,
      organization_id: req.organizationId, // CRITICAL: Assign to user's organization
      points_current_quarter: 0,
      absences_this_quarter: 0,
      tardies_this_quarter: 0,
      status: 'good'
    });

    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update employee (tenant-scoped)
router.put('/:id', async (req, res) => {
  try {
    const updates = req.body;

    // Don't allow updating points/status directly (use attendance service)
    delete updates.points_current_quarter;
    delete updates.absences_this_quarter;
    delete updates.tardies_this_quarter;
    delete updates.status;
    delete updates.organization_id; // Prevent changing organization

    const employee = await Employee.findOneAndUpdate(
      scopeQuery(req.organizationId, { _id: req.params.id }),
      updates,
      { new: true, runValidators: true }
    ).populate('supervisor_id');

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete employee (tenant-scoped)
router.delete('/:id', async (req, res) => {
  try {
    const employee = await Employee.findOneAndDelete(
      scopeQuery(req.organizationId, { _id: req.params.id })
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get employee absences (tenant-scoped)
router.get('/:id/absences', async (req, res) => {
  try {
    // First validate employee belongs to organization
    await validateTenantAccess(Employee, req.params.id, req.organizationId);

    const { startDate, endDate } = req.query;

    const query = scopeQuery(req.organizationId, { employee_id: req.params.id });

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const absences = await Absence.find(query)
      .sort({ date: -1 })
      .limit(100);

    res.json({ success: true, absences });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset employee points (for new quarter) - tenant-scoped
router.post('/:id/reset-points', async (req, res) => {
  try {
    const employee = await validateTenantAccess(Employee, req.params.id, req.organizationId);

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    employee.points_current_quarter = 0;
    employee.absences_this_quarter = 0;
    employee.tardies_this_quarter = 0;
    employee.status = 'good';

    await employee.save();

    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk import employees (tenant-scoped)
router.post('/bulk-import', async (req, res) => {
  try {
    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ success: false, error: 'No employees provided' });
    }

    // Assign supervisor and organization
    const supervisor_id = req.user._id;
    const organization_id = req.organizationId;

    // Add supervisor and organization_id to all employees
    const employeesWithOrgAndSupervisor = employees.map(emp => ({
      ...emp,
      supervisor_id,
      organization_id, // CRITICAL: Assign to user's organization
      points_current_quarter: 0,
      absences_this_quarter: 0,
      tardies_this_quarter: 0,
      status: 'good'
    }));

    const created = await Employee.insertMany(employeesWithOrgAndSupervisor);

    res.json({ success: true, count: created.length, employees: created });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
