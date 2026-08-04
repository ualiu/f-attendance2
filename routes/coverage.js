const express = require('express');
const router = express.Router();
const { requireTenantAuth } = require('../middleware/auth');
const { scopeQuery, validateTenantAccess } = require('../utils/tenantHelper');
const ShiftOffer = require('../models/ShiftOffer');
const Absence = require('../models/Absence');
const Employee = require('../models/Employee');
const Organization = require('../models/Organization');
const coverageService = require('../services/coverageService');

// All coverage routes require authentication + tenant scoping
router.use(requireTenantAuth);

// List recent shift-coverage offers (tenant-scoped)
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offers = await ShiftOffer.find(scopeQuery(req.organizationId))
      .sort({ createdAt: -1 })
      .limit(limit);

    res.json({ success: true, offers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a single offer (tenant-scoped)
router.get('/:id', async (req, res) => {
  try {
    const offer = await validateTenantAccess(ShiftOffer, req.params.id, req.organizationId);
    res.json({ success: true, offer });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually start coverage for any absence (e.g. an admin-logged no-show,
// which the automatic SMS trigger never sees since it only fires on
// full-day call-ins reported via text).
router.post('/start/:absenceId', async (req, res) => {
  try {
    const absence = await validateTenantAccess(Absence, req.params.absenceId, req.organizationId);

    const existing = await ShiftOffer.findOne({
      absence_id: absence._id,
      status: { $in: ['open', 'claimed'] }
    });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Coverage is already in progress for this absence', offer: existing });
    }

    const employee = await validateTenantAccess(Employee, absence.employee_id, req.organizationId);
    const organization = await Organization.findById(req.organizationId);

    const offer = await coverageService.startCoverage({ absence, employee, organization, trigger: 'manual' });
    res.json({ success: true, offer });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Absence not found' });
    }
    console.error('Error starting manual coverage:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Approve a claimed offer from the dashboard (works whether or not the
// manager has a phone number - this is the only path for SMS-less orgs).
router.post('/:id/approve', async (req, res) => {
  try {
    await validateTenantAccess(ShiftOffer, req.params.id, req.organizationId);
    const result = await coverageService.approveOffer(req.params.id, { via: 'dashboard' });
    if (!result.ok) {
      return res.status(409).json({ success: false, error: 'Offer is not awaiting approval' });
    }
    res.json({ success: true, offer: result.offer });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/decline', async (req, res) => {
  try {
    await validateTenantAccess(ShiftOffer, req.params.id, req.organizationId);
    const result = await coverageService.declineByManager(req.params.id, { via: 'dashboard' });
    if (!result.ok) {
      return res.status(409).json({ success: false, error: 'Offer is not awaiting approval' });
    }
    res.json({ success: true, offer: result.offer });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancel an in-progress offer manually (mirrors what the SMS correction hook
// does automatically when an absence is undone).
router.post('/:id/cancel', async (req, res) => {
  try {
    const offer = await validateTenantAccess(ShiftOffer, req.params.id, req.organizationId);
    const cancelled = await coverageService.cancelOfferForAbsence(offer.absence_id, 'manual_cancel');
    if (!cancelled) {
      return res.status(409).json({ success: false, error: 'Offer is not in a cancellable state' });
    }
    res.json({ success: true, offer: cancelled });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Offer not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
