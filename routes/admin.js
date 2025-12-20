const express = require('express');
const router = express.Router();
const { requireTenantAuth, ensureAdmin } = require('../middleware/auth');
const { scopeQuery } = require('../utils/tenantHelper');
const Employee = require('../models/Employee');

// All admin routes require authentication + tenant scoping + admin role
router.use(requireTenantAuth);
router.use(ensureAdmin);

// Employee management page
router.get('/employees', async (req, res) => {
  try {
    const employees = await Employee.find(scopeQuery(req.organizationId))
      .sort({ name: 1 });

    res.render('admin/manage', {
      title: 'Employee Management',
      user: req.user,
      employees
    });
  } catch (error) {
    console.error('Error loading employees:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
