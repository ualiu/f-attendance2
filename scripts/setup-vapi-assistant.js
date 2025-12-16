/**
 * Script to programmatically create/update VAPI assistant
 * Run with: node scripts/setup-vapi-assistant.js
 */

require('dotenv').config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const SERVER_URL = process.env.SERVER_URL || 'https://your-app.railway.app';

if (!VAPI_API_KEY) {
  console.error('❌ VAPI_API_KEY not found in .env file');
  process.exit(1);
}

const systemPrompt = `You are the AI attendance assistant for Felton Brushes. Keep conversations SHORT and EFFICIENT.

## YOUR ROLE
Be professional, empathetic, and BRIEF. Your job:
1. Log attendance quickly
2. Inform point status (ONE sentence)
3. Only offer support if 4+ points
4. Don't repeat information

## COMPANY INFORMATION
- Company: Felton Brushes
- Location: Hamilton, Ontario, Canada
- Phone: (905) 522-3811 ext #8
- Employees: ~20 production workers
- Departments: Production, Maintenance

## ATTENDANCE POLICY (CRITICAL - KNOW THIS PERFECTLY)

**Point System:**
- 1 full absence (sick/personal) = 1.0 point
- 1 tardy (>15 minutes late) = 0.33 points
- 3 tardies = 1 absence
- Points reset quarterly (Jan 1, Apr 1, Jul 1, Oct 1)

**Thresholds:**
- 0-2 points: Good standing ✅
- 3 points: Watch status ⚠️
- 4-5 points: At risk 🟠
- 6 points: Formal review required 🔴
- 8 points: Termination review 🚨

**Important Rules:**
- Employees must call 30 minutes BEFORE shift start
- Approved PTO (requested in advance) does NOT count as points
- FMLA/medical accommodation absences do NOT count
- Calling after shift starts = late notice (may add extra point)

**Shift Times:**
- Day shift: 7:00 AM - 3:30 PM
- Night shift: 11:30 PM - 7:00 AM
- Weekend shift: Varies

## CONVERSATION RULES (CRITICAL)

**BE CONCISE:**
- NO small talk
- NO repeating what they said
- NO long explanations
- Get name → Get reason → Give points → Done

**CONVERSATION FLOW:**

1. **Greeting:** "Felton attendance. Your name?"
2. **Get their name, use get_employee_record**
3. **Confirm station:** "You're at [station], right?"
4. **Get reason:** "Sick or late?"
5. **Log it:** Use log_absence or log_tardy
6. **Point status (ONE sentence):**
   - 0-2: "You're at [X] points, good standing."
   - 3: "You're at 3 points, watch status."
   - 4-5: "You're at [X] points, at risk. 6 triggers review."
   - 6: "You're at 6 points, formal review required."
   - 7+: "You're at [X] points. 8 means termination review."
7. **Only if 4+ points:** "Need anything? Want to talk to your supervisor?"
8. **End:** "Take care." (hang up)

**EXAMPLES OF GOOD (BRIEF) RESPONSES:**
- ✅ "Logged. 2 points, good standing."
- ✅ "Got it. 5 points, you're at risk."
- ✅ "Marked absent. 6 points, review required."

**EXAMPLES OF BAD (TOO LONG):**
- ❌ "Okay, I understand you're not feeling well today. I'm sorry to hear that. Let me go ahead and log this absence for you..."
- ❌ "So just to confirm, you're calling in sick for today, is that correct?"
- ❌ "Thank you so much for calling. Your absence has been recorded..."

**NEVER:**
- Say "let me pull up your information" (just do it)
- Repeat their reason back to them
- Ask "is that correct?" after everything
- Explain HOW you're logging things
- Give long policy explanations

## TONE
Professional, neutral, efficient. Like a receptionist, not a counselor.

## CRITICAL REMINDERS
1. Keep it SHORT (30-60 seconds max)
2. Don't repeat information
3. One question at a time
4. No confirmations unless necessary
5. Get to the point
6. Empathy = "Got it" not a speech

**TARGET CALL LENGTH:** Under 1 minute for routine calls.

You represent Felton Brushes. Be professional, brief, and efficient.`;

const assistantConfig = {
  name: 'Felton Brushes Attendance Assistant',
  transcriber: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en'
  },
  model: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    temperature: 0.3, // Lower = more consistent and concise
    maxTokens: 150, // Force short responses (was 500)
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'system',
        content: 'REMINDER: Keep responses under 20 words. Be extremely brief.'
      }
    ]
  },
  voice: {
    provider: 'playht',
    voiceId: 'jennifer' // Professional, warm female voice
  },
  firstMessage: 'Felton attendance. Your name?',
  endCallMessage: 'Take care.',
  endCallPhrases: ['goodbye', 'bye', 'thanks', 'that\'s all', 'that\'s it'],
  silenceTimeoutSeconds: 30, // Hang up if silent for 30 seconds
  maxDurationSeconds: 300, // Max 5 minute calls
  recordingEnabled: true,
  serverUrl: `${SERVER_URL}/api/calls/vapi-function`,
  serverUrlSecret: process.env.VAPI_SERVER_SECRET || 'felton-vapi-secret',

  // Function definitions
  functions: [
    {
      name: 'get_employee_record',
      description: 'Look up employee by name to get their ID, department, shift, work station, and current points',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Full employee name (first and last)'
          }
        },
        required: ['name']
      }
    },
    {
      name: 'log_absence',
      description: 'Log an absence for an employee',
      parameters: {
        type: 'object',
        properties: {
          employee_id: {
            type: 'string',
            description: 'Employee ID from get_employee_record'
          },
          type: {
            type: 'string',
            enum: ['sick', 'personal', 'approved_pto'],
            description: 'Type of absence'
          },
          reason: {
            type: 'string',
            description: 'Reason for absence'
          },
          expected_return: {
            type: 'string',
            description: 'Expected return date (YYYY-MM-DD format)'
          },
          work_station: {
            type: 'string',
            description: 'Work station from get_employee_record'
          }
        },
        required: ['employee_id', 'type', 'reason', 'work_station']
      }
    },
    {
      name: 'log_tardy',
      description: 'Log a tardy arrival for an employee',
      parameters: {
        type: 'object',
        properties: {
          employee_id: {
            type: 'string',
            description: 'Employee ID from get_employee_record'
          },
          minutes_late: {
            type: 'number',
            description: 'How many minutes late'
          },
          reason: {
            type: 'string',
            description: 'Reason for being late'
          }
        },
        required: ['employee_id', 'minutes_late', 'reason']
      }
    },
    {
      name: 'check_threshold_status',
      description: 'Check if employee is approaching attendance thresholds and get coaching message',
      parameters: {
        type: 'object',
        properties: {
          employee_id: {
            type: 'string',
            description: 'Employee ID from get_employee_record'
          }
        },
        required: ['employee_id']
      }
    }
  ]
};

async function createAssistant() {
  console.log('🚀 Creating VAPI Assistant...\n');

  try {
    const response = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(assistantConfig)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VAPI API error: ${response.status} - ${error}`);
    }

    const assistant = await response.json();

    console.log('✅ Assistant created successfully!\n');
    console.log('📋 Assistant Details:');
    console.log(`   ID: ${assistant.id}`);
    console.log(`   Name: ${assistant.name}`);
    console.log(`   Model: ${assistant.model.model}`);
    console.log(`   Voice: ${assistant.voice.provider} - ${assistant.voice.voiceId}`);
    console.log('\n💾 Save this Assistant ID to your .env file:');
    console.log(`   VAPI_ASSISTANT_ID=${assistant.id}\n`);

    return assistant;
  } catch (error) {
    console.error('❌ Error creating assistant:', error.message);
    throw error;
  }
}

async function updateAssistant(assistantId) {
  console.log(`🔄 Updating Assistant ${assistantId}...\n`);

  try {
    const response = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(assistantConfig)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`VAPI API error: ${response.status} - ${error}`);
    }

    const assistant = await response.json();

    console.log('✅ Assistant updated successfully!\n');
    console.log('📋 Updated Assistant Details:');
    console.log(`   ID: ${assistant.id}`);
    console.log(`   Name: ${assistant.name}\n`);

    return assistant;
  } catch (error) {
    console.error('❌ Error updating assistant:', error.message);
    throw error;
  }
}

async function getAssistant(assistantId) {
  try {
    const response = await fetch(`https://api.vapi.ai/assistant/${assistantId}`, {
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    return null;
  }
}

// Main execution
async function main() {
  const assistantId = process.env.VAPI_ASSISTANT_ID;

  if (assistantId) {
    console.log(`🔍 Checking if Assistant ${assistantId} exists...\n`);
    const existing = await getAssistant(assistantId);

    if (existing) {
      console.log('✅ Assistant found! Updating...\n');
      await updateAssistant(assistantId);
    } else {
      console.log('⚠️  Assistant not found. Creating new one...\n');
      await createAssistant();
    }
  } else {
    console.log('📝 No VAPI_ASSISTANT_ID found. Creating new assistant...\n');
    await createAssistant();
  }

  console.log('\n🎉 Setup complete!');
  console.log('\n📞 Next steps:');
  console.log('   1. Add VAPI_ASSISTANT_ID to your .env file');
  console.log('   2. Configure phone number in VAPI dashboard');
  console.log('   3. Test by calling your VAPI number\n');
}

main().catch(console.error);
