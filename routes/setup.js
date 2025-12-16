const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAuth, ensureAdmin } = require('../middleware/auth');
const Employee = require('../models/Employee');
const WorkStation = require('../models/WorkStation');
const Supervisor = require('../models/Supervisor');

// Configure multer for CSV uploads
const upload = multer({ dest: 'uploads/' });

// All admin routes require authentication
router.use(requireAuth);

// Show setup wizard
router.get('/setup', async (req, res) => {
  try {
    const employeeCount = await Employee.countDocuments();
    const stationCount = await WorkStation.countDocuments();

    res.render('setup/wizard', {
      step: 1,
      employeeCount,
      stationCount
    });
  } catch (error) {
    console.error('Error loading setup:', error);
    res.status(500).send('Server error');
  }
});

// Get setup data
router.get('/setup/data', async (req, res) => {
  try {
    const stations = await WorkStation.find({}).populate('primary_worker backup_workers');
    const employees = await Employee.find({}).populate('supervisor_id');

    res.json({
      success: true,
      stations,
      employees
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create work station
router.post('/stations', async (req, res) => {
  try {
    const { line, stationName, department, critical } = req.body;

    const station = await WorkStation.create({
      name: `${line} - ${stationName}`,
      line,
      department: department || 'Production',
      required_for_production: critical !== false,
      primary_worker: null,
      backup_workers: []
    });

    res.json({ success: true, station });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update work station
router.put('/stations/:id', async (req, res) => {
  try {
    const { line, stationName, department, critical, primary_worker, backup_workers, shifts } = req.body;

    const updates = {};
    if (line && stationName) updates.name = `${line} - ${stationName}`;
    if (line) updates.line = line;
    if (department) updates.department = department;
    if (critical !== undefined) updates.required_for_production = critical;

    // Handle shift-based assignments
    if (shifts) {
      updates.shifts = shifts;
    }

    // Legacy support for old primary_worker/backup_workers format
    if (primary_worker !== undefined) updates.primary_worker = primary_worker || null;
    if (backup_workers !== undefined) updates.backup_workers = backup_workers;

    // Update the station
    const station = await WorkStation.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    ).populate([
      'shifts.day.primary_worker',
      'shifts.day.backup_workers',
      'shifts.afternoon.primary_worker',
      'shifts.afternoon.backup_workers',
      'shifts.night.primary_worker',
      'shifts.night.backup_workers'
    ]);

    res.json({ success: true, station });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Toggle station operational status
router.put('/stations/:id/operational', async (req, res) => {
  try {
    const { is_operational, reason } = req.body;
    const station = await WorkStation.findById(req.params.id);

    if (!station) {
      return res.status(404).json({ success: false, error: 'Station not found' });
    }

    const now = new Date();
    const wasOperational = station.is_operational;

    // If going from operational to down
    if (wasOperational && !is_operational) {
      station.downtime_history.push({
        went_down_at: now,
        came_back_up_at: null,
        duration_minutes: 0,
        reason: reason || 'Not specified'
      });
    }

    // If going from down to operational
    if (!wasOperational && is_operational) {
      // Find the most recent downtime entry
      const lastDowntime = station.downtime_history[station.downtime_history.length - 1];
      if (lastDowntime && !lastDowntime.came_back_up_at) {
        lastDowntime.came_back_up_at = now;
        const durationMs = now - lastDowntime.went_down_at;
        lastDowntime.duration_minutes = Math.floor(durationMs / 60000);
        station.total_downtime_minutes += lastDowntime.duration_minutes;

        // Add resolution notes
        if (reason) {
          lastDowntime.resolution_notes = reason;
        }
      }
    }

    station.is_operational = is_operational;
    station.last_status_change = now;
    await station.save();

    res.json({ success: true, station });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete work station
router.delete('/stations/:id', async (req, res) => {
  try {
    await WorkStation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Assign employee to station
router.post('/stations/:id/assign', async (req, res) => {
  try {
    const { employeeId, isPrimary } = req.body;

    const employee = await Employee.findById(employeeId);
    const station = await WorkStation.findById(req.params.id);

    if (!employee || !station) {
      return res.status(404).json({ success: false, error: 'Employee or station not found' });
    }

    if (isPrimary) {
      // Remove old primary worker if exists
      if (station.primary_worker) {
        await Employee.findByIdAndUpdate(station.primary_worker, {
          work_station: null
        });
      }

      // Set as primary worker
      station.primary_worker = employeeId;
      employee.work_station = station.name;

      await employee.save();
    } else {
      // Add as backup
      if (!station.backup_workers.includes(employeeId)) {
        station.backup_workers.push(employeeId);
      }
    }

    await station.save();

    const updatedStation = await WorkStation.findById(req.params.id)
      .populate('primary_worker backup_workers');

    res.json({ success: true, station: updatedStation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove employee from station
router.post('/stations/:id/remove', async (req, res) => {
  try {
    const { employeeId, isPrimary } = req.body;

    const station = await WorkStation.findById(req.params.id);

    if (!station) {
      return res.status(404).json({ success: false, error: 'Station not found' });
    }

    if (isPrimary) {
      station.primary_worker = null;
      await Employee.findByIdAndUpdate(employeeId, { work_station: null });
    } else {
      station.backup_workers = station.backup_workers.filter(
        id => id.toString() !== employeeId.toString()
      );
    }

    await station.save();

    const updatedStation = await WorkStation.findById(req.params.id)
      .populate('primary_worker backup_workers');

    res.json({ success: true, station: updatedStation });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Show management page
router.get('/manage', async (req, res) => {
  try {
    const employees = await Employee.find({}).sort({ name: 1 });
    const stations = await WorkStation.find({}).populate('primary_worker backup_workers');

    // Group stations by line
    const stationsByLine = {};
    stations.forEach(station => {
      if (!stationsByLine[station.line]) {
        stationsByLine[station.line] = [];
      }
      stationsByLine[station.line].push(station);
    });

    res.render('admin/manage', {
      employees,
      stations,
      stationsByLine
    });
  } catch (error) {
    console.error('Error loading management page:', error);
    res.status(500).send('Server error');
  }
});

// User management (admin only)
router.get('/users', ensureAdmin, async (req, res) => {
  try {
    const supervisors = await Supervisor.find({}).sort({ created_at: -1 });
    res.render('admin/users', { supervisors });
  } catch (error) {
    console.error('Error loading users:', error);
    res.status(500).send('Server error');
  }
});

// Toggle user active status (admin only)
router.post('/users/:id/toggle', ensureAdmin, async (req, res) => {
  try {
    const supervisor = await Supervisor.findById(req.params.id);

    if (!supervisor) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    supervisor.is_active = !supervisor.is_active;
    await supervisor.save();

    res.json({ success: true, is_active: supervisor.is_active });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Change user role (admin only)
router.post('/users/:id/role', ensureAdmin, async (req, res) => {
  try {
    const { role } = req.body;

    if (!['admin', 'supervisor', 'manager'].includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }

    const supervisor = await Supervisor.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    );

    res.json({ success: true, supervisor });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
