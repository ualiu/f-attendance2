/**
 * Verify VAPI assistant configuration
 * Run with: node scripts/verify-vapi-config.js
 */

require('dotenv').config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID) {
  console.error('❌ Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env');
  process.exit(1);
}

async function verifyConfig() {
  console.log('\n🔍 Fetching VAPI Assistant Configuration...\n');

  try {
    const response = await fetch(`https://api.vapi.ai/assistant/${VAPI_ASSISTANT_ID}`, {
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`
      }
    });

    if (!response.ok) {
      throw new Error(`VAPI API error: ${response.status}`);
    }

    const assistant = await response.json();

    console.log('✅ Assistant Found\n');
    console.log('📋 Configuration:');
    console.log(`   ID: ${assistant.id}`);
    console.log(`   Name: ${assistant.name}`);
    console.log(`   Model: ${assistant.model?.model || 'N/A'}`);
    console.log(`   Voice: ${assistant.voice?.provider} - ${assistant.voice?.voiceId}`);

    console.log('\n🔗 Server Configuration:');
    console.log(`   Server URL: ${assistant.server?.url || assistant.serverUrl || 'NOT SET ❌'}`);
    console.log(`   Server Secret: ${assistant.server?.secret || assistant.serverUrlSecret ? '***SET***' : 'NOT SET ❌'}`);
    console.log('\n🔍 Full Server Object:', JSON.stringify(assistant.server, null, 2));

    console.log('\n🔧 Functions:');
    if (assistant.functions && assistant.functions.length > 0) {
      assistant.functions.forEach((fn, i) => {
        console.log(`   ${i + 1}. ${fn.name}`);
      });
    } else {
      console.log('   ❌ No functions configured!');
    }

    if (!assistant.server?.url && !assistant.serverUrl) {
      console.log('\n⚠️  WARNING: Server URL is NOT configured!');
      console.log('   VAPI will NOT call your server for function execution.');
      console.log('   Run: node scripts/setup-vapi-assistant.js');
    } else {
      console.log('\n✅ Server URL is configured correctly!');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

verifyConfig();
