const express = require('express');
const router = express.Router();
const WorkStation = require('../models/WorkStation');
const Employee = require('../models/Employee');

// Simple test page to show stations with edit buttons
router.get('/test-stations', async (req, res) => {
  try {
    const stations = await WorkStation.find({})
      .populate('primary_worker backup_workers')
      .sort({ line: 1, name: 1 });

    const employees = await Employee.find({}).sort({ name: 1 });

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Test Stations Page</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      background: #f5f5f5;
    }
    .station {
      background: white;
      border: 3px solid #0066cc;
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 8px;
    }
    .station h2 {
      margin: 0 0 15px 0;
      color: #333;
    }
    .edit-btn {
      background: #0066cc;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      border-radius: 4px;
      margin-right: 10px;
    }
    .edit-btn:hover {
      background: #0052a3;
    }
    .delete-btn {
      background: #dc3545;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      border-radius: 4px;
    }
    .info {
      background: #e3f2fd;
      padding: 15px;
      margin-bottom: 20px;
      border-left: 4px solid #0066cc;
    }
  </style>
</head>
<body>
  <div class="info">
    <h1>🧪 TEST PAGE - Stations with Edit Buttons</h1>
    <p><strong>This is a simple test page to verify buttons work.</strong></p>
    <p>If you can see and click the EDIT buttons below, then the issue is with the main manage page.</p>
    <p><strong>Found ${stations.length} station(s) and ${employees.length} employee(s)</strong></p>
  </div>

  ${stations.length === 0 ? '<p style="color: red; font-size: 20px;">❌ NO STATIONS FOUND! Please create stations first.</p>' : ''}

  ${stations.map(station => `
    <div class="station">
      <h2>📍 ${station.name}</h2>
      <p><strong>Department:</strong> ${station.department}</p>
      <p><strong>Critical:</strong> ${station.required_for_production ? 'Yes' : 'No'}</p>
      <p><strong>Primary Worker:</strong> ${station.primary_worker ? station.primary_worker.name : 'Unassigned'}</p>
      <p><strong>Backup Workers:</strong> ${station.backup_workers.length > 0 ? station.backup_workers.map(w => w.name).join(', ') : 'None'}</p>
      <p><strong>Station ID:</strong> ${station._id}</p>
      <hr>
      <button class="edit-btn" onclick="alert('Edit clicked for station: ${station.name}\\nStation ID: ${station._id}\\n\\nThis proves the button works!\\n\\nGo back to /admin/manage to use real edit.')">
        ✏️ EDIT THIS STATION
      </button>
      <button class="delete-btn" onclick="alert('Delete clicked for: ${station.name}')">
        🗑️ DELETE
      </button>
    </div>
  `).join('')}

  <hr style="margin: 30px 0;">

  <div class="info">
    <h3>✅ If You Can See Buttons Above:</h3>
    <p>The buttons work fine. The problem is with the main /admin/manage page.</p>
    <p>Possible causes:</p>
    <ul>
      <li>CSS not loading</li>
      <li>JavaScript error</li>
      <li>Browser cache</li>
      <li>Tab switching not working</li>
    </ul>

    <h3>📋 Next Steps:</h3>
    <ol>
      <li>Clear browser cache completely</li>
      <li>Try a different browser (Chrome, Firefox, Edge)</li>
      <li>Check browser console (F12) for errors</li>
      <li>Go back to <a href="/admin/manage">/admin/manage</a> and try again</li>
    </ol>

    <h3>🔧 Available Employees for Assignment:</h3>
    <ul>
      ${employees.map(emp => `<li>${emp.name} (${emp.employee_id}) - ID: ${emp._id}</li>`).join('')}
    </ul>
  </div>
</body>
</html>
    `);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Test: Check if any supervisors exist
router.get('/check-users', async (req, res) => {
  try {
    const Supervisor = require('../models/Supervisor');
    const supervisors = await Supervisor.find({});

    res.send(`
      <h1>👥 User Check</h1>
      <p><strong>Total Supervisors:</strong> ${supervisors.length}</p>
      <hr>
      ${supervisors.length === 0 ? `
        <p style="color: red;">❌ No users found!</p>
        <p><a href="/create-admin">Create Admin Account</a></p>
      ` : `
        <h3>Users:</h3>
        <ul>
          ${supervisors.map(s => `
            <li>
              <strong>${s.name}</strong> (${s.email})<br>
              Role: ${s.role}<br>
              Has password: ${s.password_hash ? 'Yes ✅' : 'No ❌ (Google only)'}<br>
              Password hash: ${s.password_hash ? s.password_hash.substring(0, 20) + '...' : 'none'}<br>
              Active: ${s.is_active ? 'Yes' : 'No'}
            </li>
          `).join('')}
        </ul>
      `}
      <hr>
      <p><a href="/login">Go to Login</a></p>
      <p><a href="/test/test-login">Test Login Function</a></p>
    `);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Test: Test login function
router.post('/test-login', async (req, res) => {
  try {
    const Supervisor = require('../models/Supervisor');
    const bcrypt = require('bcrypt');
    const { email, password } = req.body;

    const supervisor = await Supervisor.findOne({ email });

    if (!supervisor) {
      return res.json({
        success: false,
        error: 'User not found',
        email: email
      });
    }

    if (!supervisor.password_hash) {
      return res.json({
        success: false,
        error: 'No password set for this account',
        email: email,
        hasPasswordHash: false
      });
    }

    const isMatch = await bcrypt.compare(password, supervisor.password_hash);

    res.json({
      success: isMatch,
      email: email,
      hasPasswordHash: true,
      passwordMatch: isMatch,
      isActive: supervisor.is_active,
      role: supervisor.role
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/test-login', (req, res) => {
  res.send(`
    <h1>Test Login</h1>
    <form action="/test/test-login" method="POST">
      <div>
        <label>Email:</label><br>
        <input type="email" name="email" placeholder="urim.aliu@gmail.com" required>
      </div>
      <div style="margin-top: 10px;">
        <label>Password:</label><br>
        <input type="password" name="password" required>
      </div>
      <button type="submit" style="margin-top: 10px;">Test Login</button>
    </form>
    <p><a href="/test/check-users">Back to User List</a></p>
  `);
});

// Test: Create a sample call/absence to see on dashboard
router.get('/create-test-call', async (req, res) => {
  try {
    const Employee = require('../models/Employee');
    const Absence = require('../models/Absence');
    const attendanceService = require('../services/attendanceService');

    // Get first employee
    const employee = await Employee.findOne();

    if (!employee) {
      return res.send('No employees found. Create an employee first at /admin/manage');
    }

    // Create test absence
    const absence = await Absence.create({
      employee_id: employee._id,
      employee_name: employee.name,
      work_station: employee.work_station || 'Test Station',
      date: new Date(),
      type: 'sick',
      reason: 'Test call from VAPI - Flu symptoms',
      call_time: new Date(),
      call_duration: 145, // 2 minutes 25 seconds
      call_transcript: 'AI: Hi, this is Felton Brushes. Who am I speaking with?\nEmployee: ' + employee.name + '\nAI: Hi ' + employee.name + '! Are you calling because you\'re sick or late?\nEmployee: I\'m sick\nAI: What\'s the reason?\nEmployee: I have the flu\nAI: I\'ve logged your absence. Feel better!',
      points_awarded: 1.0,
      late_notice: false,
      station_impacted: true
    });

    // Update employee stats
    await attendanceService.updateEmployeeStats(employee._id);

    res.send(`
      <h1>✅ Test Call Created!</h1>
      <p><strong>Employee:</strong> ${employee.name}</p>
      <p><strong>Type:</strong> Sick Day</p>
      <p><strong>Points:</strong> 1.0</p>
      <hr>
      <p>Go to <a href="/dashboard">Dashboard</a> to see the call!</p>
      <p>Or go to <a href="/admin/manage">Manage</a> to see updated employee stats.</p>
    `);
  } catch (error) {
    res.status(500).send(`Error: ${error.message}`);
  }
});

module.exports = router;
