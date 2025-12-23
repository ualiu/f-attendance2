const express = require('express');
const router = express.Router();
const { requireTenantAuth, ensureAdmin } = require('../middleware/auth');
const Organization = require('../models/Organization');

// All organization routes require authentication + tenant scoping + admin role
router.use(requireTenantAuth);
router.use(ensureAdmin);

// Update LLM provider setting
router.put('/settings/llm-provider', async (req, res) => {
  try {
    const { llm_provider } = req.body;

    // Validate provider
    if (!['claude', 'openai'].includes(llm_provider)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid LLM provider. Must be "claude" or "openai"'
      });
    }

    // Update organization settings
    const organization = await Organization.findById(req.organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    organization.settings.llm_provider = llm_provider;
    await organization.save();

    console.log(`✅ Organization ${organization.name} switched to ${llm_provider.toUpperCase()} LLM provider`);

    res.json({
      success: true,
      message: `LLM provider updated to ${llm_provider}`,
      llm_provider
    });
  } catch (error) {
    console.error('Error updating LLM provider:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update timezone setting
router.put('/settings/timezone', async (req, res) => {
  try {
    const { timezone } = req.body;

    // Validate timezone (basic check - could be more comprehensive)
    if (!timezone || typeof timezone !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Invalid timezone'
      });
    }

    // Update organization settings
    const organization = await Organization.findById(req.organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    organization.settings.timezone = timezone;
    await organization.save();

    console.log(`✅ Organization ${organization.name} timezone updated to ${timezone}`);

    res.json({
      success: true,
      message: `Timezone updated to ${timezone}`,
      timezone
    });
  } catch (error) {
    console.error('Error updating timezone:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update shift start and end times
router.put('/settings/shift-times', async (req, res) => {
  try {
    const { day_start, day_end, night_start, night_end, weekend_start, weekend_end } = req.body;

    // Validate time format (HH:MM)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

    const timesToValidate = [
      { value: day_start, name: 'day start' },
      { value: day_end, name: 'day end' },
      { value: night_start, name: 'night start' },
      { value: night_end, name: 'night end' },
      { value: weekend_start, name: 'weekend start' },
      { value: weekend_end, name: 'weekend end' }
    ];

    for (const time of timesToValidate) {
      if (time.value && !timeRegex.test(time.value)) {
        return res.status(400).json({
          success: false,
          error: `Invalid ${time.name} time format. Use HH:MM (24-hour format)`
        });
      }
    }

    // Update organization settings
    const organization = await Organization.findById(req.organizationId);
    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found'
      });
    }

    // Update shift times
    if (day_start) organization.settings.shift_times.day_start = day_start;
    if (day_end) organization.settings.shift_times.day_end = day_end;
    if (night_start) organization.settings.shift_times.night_start = night_start;
    if (night_end) organization.settings.shift_times.night_end = night_end;
    if (weekend_start) organization.settings.shift_times.weekend_start = weekend_start;
    if (weekend_end) organization.settings.shift_times.weekend_end = weekend_end;

    await organization.save();

    console.log(`✅ Organization ${organization.name} shift times updated`);

    res.json({
      success: true,
      message: 'Shift times updated successfully',
      shift_times: organization.settings.shift_times
    });
  } catch (error) {
    console.error('Error updating shift times:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
