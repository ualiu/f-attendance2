const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const WorkStation = require('../models/WorkStation');
const attendanceService = require('../services/attendanceService');

// All dashboard routes require authentication
router.use(requireAuth);

// Main dashboard
router.get('/', async (req, res) => {
  try {
    // Get today's summary
    const todaysSummary = await attendanceService.getTodaysSummary();

    // Get employees at risk
    const alertEmployees = await attendanceService.getAtRiskEmployees();

    // Get affected stations today
    const affectedStations = await attendanceService.getAffectedStationsToday();

    // Get recent absence reports (last 10)
    const recentAbsences = await Absence.find({})
      .populate('employee_id')
      .sort({ report_time: -1 })
      .limit(10);

    res.render('dashboard/index', {
      title: 'Dashboard',
      todaysSummary,
      alertEmployees,
      affectedStations,
      recentAbsences
    });
  } catch (error) {
    console.error('Error loading dashboard:', error);
    res.status(500).send('Server error');
  }
});

// Work stations view
router.get('/stations', async (req, res) => {
  try {
    const stations = await WorkStation.find({})
      .populate('primary_worker backup_workers')
      .sort({ line: 1, name: 1 });

    // Get today's affected stations
    const affectedStations = await attendanceService.getAffectedStationsToday();
    const affectedStationIds = affectedStations.map(s => s._id.toString());

    // Group stations by line
    const stationsByLine = {};
    stations.forEach(station => {
      if (!stationsByLine[station.line]) {
        stationsByLine[station.line] = [];
      }

      const stationObj = station.toObject();
      stationObj.isAffectedToday = affectedStationIds.includes(station._id.toString());

      stationsByLine[station.line].push(stationObj);
    });

    res.render('dashboard/stations', {
      title: 'Work Stations',
      stationsByLine,
      affectedStations
    });
  } catch (error) {
    console.error('Error loading stations:', error);
    res.status(500).send('Server error');
  }
});

// Employee detail view
router.get('/employee/:id', async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id)
      .populate('supervisor_id');

    if (!employee) {
      return res.status(404).send('Employee not found');
    }

    // Get all absences for this quarter
    const quarterStart = new Date();
    const month = quarterStart.getMonth();
    if (month < 3) quarterStart.setMonth(0, 1);
    else if (month < 6) quarterStart.setMonth(3, 1);
    else if (month < 9) quarterStart.setMonth(6, 1);
    else quarterStart.setMonth(9, 1);
    quarterStart.setHours(0, 0, 0, 0);

    const absences = await Absence.find({
      employee_id: employee._id,
      date: { $gte: quarterStart }
    }).sort({ date: -1 });

    // Get work station info
    const station = await WorkStation.findOne({ name: employee.work_station })
      .populate('primary_worker backup_workers');

    res.render('dashboard/employee', {
      title: `Employee: ${employee.name}`,
      employee,
      absences,
      station,
      quarterStart
    });
  } catch (error) {
    console.error('Error loading employee:', error);
    res.status(500).send('Server error');
  }
});

// API endpoint: Get dashboard data (for AJAX updates)
router.get('/api/data', async (req, res) => {
  try {
    const todaysSummary = await attendanceService.getTodaysSummary();
    const alertEmployees = await attendanceService.getAtRiskEmployees();
    const affectedStations = await attendanceService.getAffectedStationsToday();

    res.json({
      success: true,
      todaysSummary,
      alertEmployees,
      affectedStations
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
