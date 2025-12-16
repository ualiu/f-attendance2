const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const attendanceService = require('../services/attendanceService');

// All employee routes require authentication
router.use(requireAuth);

// Get all employees
router.get('/', async (req, res) => {
  try {
    const employees = await Employee.find({})
      .populate('supervisor_id')
      .sort({ name: 1 });

    res.json({ success: true, employees });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single employee
router.get('/:id', async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('supervisor_id');

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create employee
router.post('/', async (req, res) => {
  try {
    const { employee_id, name, phone, department, shift, work_station } = req.body;

    // Assign supervisor if authenticated user is a supervisor
    const supervisor_id = req.user._id;

    const employee = await Employee.create({
      employee_id,
      name,
      phone,
      department,
      shift,
      work_station: work_station || null,
      supervisor_id,
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

// Update employee
router.put('/:id', async (req, res) => {
  try {
    const updates = req.body;

    // Don't allow updating points/status directly (use attendance service)
    delete updates.points_current_quarter;
    delete updates.absences_this_quarter;
    delete updates.tardies_this_quarter;
    delete updates.status;

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
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

// Delete employee
router.delete('/:id', async (req, res) => {
  try {
    const employee = await Employee.findByIdAndDelete(req.params.id);

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get employee absences
router.get('/:id/absences', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const query = { employee_id: req.params.id };

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
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset employee points (for new quarter)
router.post('/:id/reset-points', async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);

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

// Bulk import employees
router.post('/bulk-import', async (req, res) => {
  try {
    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ success: false, error: 'No employees provided' });
    }

    // Assign supervisor
    const supervisor_id = req.user._id;

    // Add supervisor to all employees
    const employeesWithSupervisor = employees.map(emp => ({
      ...emp,
      supervisor_id,
      points_current_quarter: 0,
      absences_this_quarter: 0,
      tardies_this_quarter: 0,
      status: 'good'
    }));

    const created = await Employee.insertMany(employeesWithSupervisor);

    res.json({ success: true, count: created.length, employees: created });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
