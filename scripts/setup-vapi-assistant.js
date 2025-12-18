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

const systemPrompt = `You are the AI attendance assistant for Felton Brushes. Be professional, conversational, and efficient.

## YOUR ROLE
Handle attendance calls with a natural conversation flow. Ask proper questions, understand their situation, log the information, and end the call naturally.

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

## CONVERSATION FLOW (FOLLOW THIS PATH)

1. **Greeting:** "Hi, this is Felton Brushes attendance line. May I have your name?"
2. **Look up employee:** Use get_employee_record with their name
   - **If name not found:** "I didn't find that name. Could you spell your first and last name for me?"
   - Try again with spelled name
   - **If still not found:** "I'm still not finding you in the system. Let me connect you with a supervisor."
3. **Confirm station:** "You're at [station], correct?"
4. **Ask about call reason:** "Would you like to report an absence or a late arrival?"

**IF ABSENCE:**
5a. "What's the reason for your absence today?"
6a. Listen to their reason, then ask: "Are you feeling sick?"
7a. "When do you expect to return to work?" or "Do you plan to come in tomorrow?"
8a. Log the absence using log_absence
9a. Check threshold and inform: "You currently have [X] points."
10a. If 4+ points: "Is there anything you need? Would you like to speak with your supervisor?"
11a. End naturally: "Alright, take care and feel better."

**IF LATE:**
5b. "How many minutes late will you be?"
6b. "What's the reason you're running late?"
7b. Log the tardy using log_tardy
8b. Check threshold and inform: "You currently have [X] points."
9b. If 4+ points: "Is there anything you need? Would you like to speak with your supervisor?"
10b. End naturally: "Okay, we'll see you when you arrive. Drive safely."

## CONVERSATION STYLE

**DO:**
- Use complete, natural questions
- Ask one question at a time
- Be empathetic but professional
- Know when to end the call naturally (after logging and informing points)
- Adjust your tone based on their point status

**DON'T:**
- Use overly brief fragments like "Sick or late?"
- Repeat what they said back to them unnecessarily
- Say "let me pull up your information" (just do it)
- Ask confirmation questions unless truly needed
- Keep talking after you've given them their points and they're ready to go

## TONE
Professional, conversational, empathetic. Like a helpful office receptionist who cares but stays on task.

## ENDING CALLS NATURALLY
Know when the conversation is done:
- After logging absence/tardy
- After telling them their points
- After offering help (if 4+ points)
- When they say "thanks" or "that's all"

Don't drag it out. If they're ready to go, let them go with: "Take care" or "Feel better" or "See you soon"

**TARGET CALL LENGTH:** 1-2 minutes for routine calls.

You represent Felton Brushes. Be professional, conversational, and efficient.`;

const assistantConfig = {
  name: 'Felton Brushes Attendance Assistant',
  transcriber: {
    provider: 'deepgram',
    model: 'nova-2',
    language: 'en'
  },
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.5, // Balanced for natural conversation
    maxTokens: 250, // Allow for complete sentences
    messages: [
      {
        role: 'system',
        content: systemPrompt
      }
    ]
  },
  voice: {
    provider: 'playht',
    voiceId: 'jennifer' // Professional, warm female voice
  },
  firstMessage: 'Hi, this is Felton Brushes attendance line. May I have your name?',
  endCallMessage: 'Take care.',
  endCallPhrases: ['goodbye', 'bye', 'thanks', 'that\'s all', 'that\'s it'],
  silenceTimeoutSeconds: 30, // Hang up if silent for 30 seconds
  maxDurationSeconds: 300, // Max 5 minute calls
  recordingEnabled: true,

  // Server configuration for function calling
  server: {
    url: `${SERVER_URL}/api/calls/vapi-function`,
    secret: process.env.VAPI_SERVER_SECRET || 'felton-vapi-secret'
  },

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
