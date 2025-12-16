/**
 * Automatically adjust AI assistant based on season
 * Run with: node scripts/seasonal-update.js
 */

require('dotenv').config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

// Check if it's winter (Nov-Mar)
function isWinter() {
  const month = new Date().getMonth(); // 0-11
  return month >= 10 || month <= 2; // Nov, Dec, Jan, Feb, Mar
}

async function updateAssistant(updates) {
  const response = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });

  if (!response.ok) {
    throw new Error(`Error: ${response.status}`);
  }

  return await response.json();
}

async function adjustForSeason() {
  if (isWinter()) {
    console.log('❄️ Winter mode: Being extra understanding about weather delays...');

    await updateAssistant({
      model: {
        messages: [{
          role: 'system',
          content: `[WINTER MODE ACTIVE]

Be extra understanding about weather-related issues:
- Snow/ice delays are common and expected
- If employee mentions weather, acknowledge: "I understand, the roads are tough today"
- Don't penalize late calls if weather-related
- Suggest talking to supervisor about flexible arrival during bad weather

[Rest of your normal system prompt...]`
        }]
      }
    });

    console.log('✅ Updated to winter mode!');
  } else {
    console.log('☀️ Summer mode: Standard attendance rules...');

    await updateAssistant({
      model: {
        messages: [{
          role: 'system',
          content: `[Your standard system prompt without winter leniency...]`
        }]
      }
    });

    console.log('✅ Updated to standard mode!');
  }
}

adjustForSeason().catch(console.error);
