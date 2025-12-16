const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const claudeService = require('../services/claudeService');
const Employee = require('../models/Employee');

// All report routes require authentication
router.use(requireAuth);

// Show reports page
router.get('/', async (req, res) => {
  try {
    const employees = await Employee.find({})
      .sort({ name: 1 });

    res.render('reports/index', {
      title: 'Generate Reports',
      employees,
      report: null
    });
  } catch (error) {
    console.error('Error loading reports page:', error);
    res.status(500).send('Server error');
  }
});

// Generate individual employee report
router.post('/employee', async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.body;

    if (!employeeId || !startDate || !endDate) {
      return res.status(400).send('Missing required fields');
    }

    const report = await claudeService.generateEmployeeReport(
      employeeId,
      new Date(startDate),
      new Date(endDate)
    );

    res.render('reports/employee-report', {
      title: 'Employee Report',
      report,
      startDate,
      endDate
    });
  } catch (error) {
    console.error('Error generating employee report:', error);
    res.status(500).send('Error generating report: ' + error.message);
  }
});

// Generate team report
router.post('/team', async (req, res) => {
  try {
    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).send('Missing required fields');
    }

    const report = await claudeService.generateTeamReport(
      req.user._id, // supervisor ID
      new Date(startDate),
      new Date(endDate)
    );

    res.render('reports/team-report', {
      title: 'Team Report',
      report,
      startDate,
      endDate
    });
  } catch (error) {
    console.error('Error generating team report:', error);
    res.status(500).send('Error generating report: ' + error.message);
  }
});

// Generate station report
router.post('/stations', async (req, res) => {
  try {
    const { department, startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).send('Missing required fields');
    }

    const report = await claudeService.generateStationReport(
      department || null,
      new Date(startDate),
      new Date(endDate)
    );

    res.render('reports/station-report', {
      title: 'Station Downtime Report',
      report,
      department,
      startDate,
      endDate
    });
  } catch (error) {
    console.error('Error generating station report:', error);
    res.status(500).send('Error generating report: ' + error.message);
  }
});

module.exports = router;
