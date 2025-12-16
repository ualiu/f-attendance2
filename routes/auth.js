const express = require('express');
const router = express.Router();
const passport = require('../config/passport');
const { ensureAuthenticated } = require('../middleware/auth');
const Employee = require('../models/Employee');
const Supervisor = require('../models/Supervisor');

// Show login page
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/dashboard');
  }
  res.render('auth/login');
});

// Google OAuth - Start authentication
router.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email']
  })
);

// Google OAuth - Callback
router.get('/auth/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/login',
    failureFlash: true
  }),
  async (req, res) => {
    // Check if this is first login (redirect to setup)
    if (!req.user.department) {
      return res.redirect('/auth/complete-profile');
    }

    // Check if system setup is complete
    const employeeCount = await Employee.countDocuments();
    if (employeeCount === 0) {
      return res.redirect('/admin/setup');
    }

    // Success - go to dashboard
    res.redirect('/dashboard');
  }
);

// Local login (email/password)
router.post('/auth/login',
  passport.authenticate('local', {
    failureRedirect: '/login?error=invalid_credentials',
    failureFlash: true
  }),
  async (req, res) => {
    // Check if system setup is complete
    const employeeCount = await Employee.countDocuments();
    if (employeeCount === 0) {
      return res.redirect('/admin/setup');
    }

    res.redirect('/dashboard');
  }
);

// Complete profile after first Google login
router.get('/auth/complete-profile', ensureAuthenticated, (req, res) => {
  res.render('auth/complete-profile', { user: req.user });
});

router.post('/auth/complete-profile', ensureAuthenticated, async (req, res) => {
  const { department } = req.body;

  req.user.department = department;
  await req.user.save();

  // Check if system setup is complete
  const employeeCount = await Employee.countDocuments();
  if (employeeCount === 0) {
    return res.redirect('/admin/setup');
  }

  res.redirect('/dashboard');
});

// Logout
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect('/login');
  });
});

// Create first admin account (for initial setup only)
router.get('/create-admin', async (req, res) => {
  try {
    // Check if any admin exists
    const adminExists = await Supervisor.findOne({ role: 'admin' });

    if (adminExists) {
      return res.status(400).send('Admin account already exists. Please login.');
    }

    res.render('auth/create-admin');
  } catch (error) {
    res.status(500).send('Server error');
  }
});

router.post('/create-admin', async (req, res) => {
  try {
    const { name, email, password, department } = req.body;

    // Check if any admin exists
    const adminExists = await Supervisor.findOne({ role: 'admin' });

    if (adminExists) {
      return res.status(400).send('Admin account already exists');
    }

    // Hash password
    const password_hash = await Supervisor.hashPassword(password);

    // Create admin
    const admin = await Supervisor.create({
      name,
      email,
      password_hash,
      department,
      role: 'admin',
      is_active: true,
      first_login: new Date()
    });

    // Auto-login
    req.login(admin, (err) => {
      if (err) {
        return res.status(500).send('Error logging in');
      }
      res.redirect('/admin/setup');
    });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
