const express = require('express');
const router = express.Router();
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');

// Get absence details
router.get('/:id/details', async (req, res) => {
  try {
    const absence = await Absence.findById(req.params.id).populate('employee_id');

    if (!absence) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    res.json({ success: true, absence });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get recent reports
router.get('/', async (req, res) => {
  try {
    const { limit = 20, employee_id } = req.query;

    const query = {};
    if (employee_id) {
      query.employee_id = employee_id;
    }

    const absences = await Absence.find(query)
      .populate('employee_id')
      .sort({ report_time: -1 })
      .limit(parseInt(limit));

    res.json({ success: true, absences });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific absence/call by ID
router.get('/:id', async (req, res) => {
  try {
    const absence = await Absence.findById(req.params.id).populate('employee_id');

    if (!absence) {
      return res.status(404).json({ success: false, error: 'Record not found' });
    }

    res.json({ success: true, absence });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug endpoint - check database status
router.get('/debug/status', async (req, res) => {
  try {
    const absenceCount = await Absence.countDocuments();
    const employeeCount = await Employee.countDocuments();

    const recentAbsences = await Absence.find({})
      .sort({ created_at: -1 })
      .limit(10)
      .lean();

    const employees = await Employee.find({}).lean();

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
        points: e.points_current_quarter
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
