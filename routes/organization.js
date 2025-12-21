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

module.exports = router;
