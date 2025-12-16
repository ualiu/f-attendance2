const express = require('express');
const router = express.Router();
const { requireAuth, ensureAdmin } = require('../middleware/auth');
const vapiService = require('../services/vapiService');

// All routes require admin
router.use(requireAuth);
router.use(ensureAdmin);

// Update AI assistant's policy
router.post('/update-policy', async (req, res) => {
  try {
    const { newPointThreshold, newMessage } = req.body;

    const updatedPrompt = `You are the AI attendance assistant for Felton Brushes.

UPDATED POLICY (Changed on ${new Date().toLocaleDateString()}):
- Formal review now triggers at ${newPointThreshold} points (was 6)
${newMessage ? `- Special message: ${newMessage}` : ''}

[Rest of system prompt...]`;

    await vapiService.updateAssistant(process.env.VAPI_ASSISTANT_ID, {
      model: {
        messages: [{
          role: 'system',
          content: updatedPrompt
        }]
      }
    });

    res.json({
      success: true,
      message: 'AI assistant updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update AI's greeting based on time of day
router.post('/update-greeting', async (req, res) => {
  try {
    const hour = new Date().getHours();
    let greeting;

    if (hour < 12) {
      greeting = 'Good morning, Felton Brushes attendance line.';
    } else if (hour < 18) {
      greeting = 'Good afternoon, Felton Brushes attendance line.';
    } else {
      greeting = 'Good evening, Felton Brushes attendance line.';
    }

    await vapiService.updateAssistant(process.env.VAPI_ASSISTANT_ID, {
      firstMessage: `${greeting} Who am I speaking with?`
    });

    res.json({ success: true, greeting });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get current assistant configuration
router.get('/config', async (req, res) => {
  try {
    const response = await fetch(`https://api.vapi.ai/assistant/${process.env.VAPI_ASSISTANT_ID}`, {
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`
      }
    });

    const assistant = await response.json();

    res.json({
      success: true,
      config: {
        name: assistant.name,
        model: assistant.model.model,
        voice: assistant.voice.provider,
        firstMessage: assistant.firstMessage
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test: Make AI more strict
router.post('/strict-mode', async (req, res) => {
  try {
    await vapiService.updateAssistant(process.env.VAPI_ASSISTANT_ID, {
      model: {
        messages: [{
          role: 'system',
          content: `[STRICT MODE ENABLED]

You are now enforcing attendance policy strictly:
- No leniency for any reason
- Be firm but professional
- Emphasize consequences at every threshold
- Always mention "This is company policy, no exceptions"

[Rest of prompt...]`
        }]
      }
    });

    res.json({ success: true, message: 'Strict mode enabled' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test: Make AI more lenient
router.post('/lenient-mode', async (req, res) => {
  try {
    await vapiService.updateAssistant(process.env.VAPI_ASSISTANT_ID, {
      model: {
        messages: [{
          role: 'system',
          content: `[LENIENT MODE ENABLED]

You are now being extra understanding:
- Show maximum empathy
- Offer suggestions for help and support
- Emphasize "we're here to help" at every turn
- Downplay point system, emphasize solutions

[Rest of prompt...]`
        }]
      }
    });

    res.json({ success: true, message: 'Lenient mode enabled' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
