const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../middleware/auth');
const claudeService = require('../services/claudeService');

// All report routes require authentication + tenant scoping
router.use(requireTenantAuth);

// Generate individual employee report (used from employee profile page)
router.get('/employee', async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;

    // Default to current quarter if no dates provided
    const today = new Date();
    const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    const quarterEnd = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3 + 3, 0);

    const finalStartDate = startDate ? new Date(startDate) : quarterStart;
    const finalEndDate = endDate ? new Date(endDate) : quarterEnd;

    if (!employeeId) {
      return res.status(400).send('Employee ID is required');
    }

    const report = await claudeService.generateEmployeeReport(
      employeeId,
      finalStartDate,
      finalEndDate,
      req.organizationId
    );

    res.render('reports/employee-report', {
      title: 'Employee Report',
      report,
      startDate: finalStartDate.toISOString().split('T')[0],
      endDate: finalEndDate.toISOString().split('T')[0]
    });
  } catch (error) {
    console.error('Error generating employee report:', error);
    res.status(500).send('Error generating report: ' + error.message);
  }
});

module.exports = router;
