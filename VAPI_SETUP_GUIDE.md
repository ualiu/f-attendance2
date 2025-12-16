# VAPI Setup Guide - Connecting Your Dashboard Assistant

## Overview

Your VAPI assistant in the dashboard needs to communicate with your backend server to:
1. Look up employee information
2. Log absences and tardies
3. Check attendance thresholds
4. Save data to your database

## Architecture

```
┌─────────────────┐
│  VAPI Dashboard │  ← You created this
│   (AI Assistant)│
└────────┬────────┘
         │
         │ Function Calls (Real-time)
         ↓
┌─────────────────────────────────┐
│  YOUR SERVER                    │
│  /api/calls/vapi-function       │ ← Handles function calls
│  (vapiService.js)               │
└────────┬────────────────────────┘
         │
         │ Saves to database
         ↓
┌─────────────────┐
│    MongoDB      │
│  (Employees,    │
│   Absences)     │
└─────────────────┘
```

## Step-by-Step Setup

### Step 1: Configure Your Server URL in VAPI Dashboard

1. Go to your VAPI dashboard
2. Select your "Felton Brushes Attendance Assistant"
3. Find the **Server URL** or **Function Server** setting
4. Enter: `https://your-domain.com/api/calls/vapi-function`
   - Replace `your-domain.com` with your actual domain
   - For local testing: Use ngrok to expose localhost (see below)

### Step 2: Add Functions in VAPI Dashboard

In your VAPI assistant settings, add these 4 functions:

#### Function 1: get_employee_record
```json
{
  "name": "get_employee_record",
  "description": "Look up employee by phone number or name to get their current attendance status",
  "parameters": {
    "type": "object",
    "properties": {
      "phone": {
        "type": "string",
        "description": "Employee phone number (optional if name is provided)"
      },
      "name": {
        "type": "string",
        "description": "Employee full name (optional if phone is provided)"
      }
    }
  }
}
```

#### Function 2: log_absence
```json
{
  "name": "log_absence",
  "description": "Log an employee absence (sick day, personal day, or approved PTO)",
  "parameters": {
    "type": "object",
    "properties": {
      "employee_id": {
        "type": "string",
        "description": "Employee ID from their record"
      },
      "type": {
        "type": "string",
        "enum": ["sick", "personal", "approved_pto"],
        "description": "Type of absence"
      },
      "reason": {
        "type": "string",
        "description": "Detailed reason for absence"
      },
      "expected_return": {
        "type": "string",
        "description": "Expected return date in YYYY-MM-DD format (optional)"
      },
      "work_station": {
        "type": "string",
        "description": "Employee's work station name"
      }
    },
    "required": ["employee_id", "type", "reason", "work_station"]
  }
}
```

#### Function 3: log_tardy
```json
{
  "name": "log_tardy",
  "description": "Log when an employee is late to work",
  "parameters": {
    "type": "object",
    "properties": {
      "employee_id": {
        "type": "string",
        "description": "Employee ID from their record"
      },
      "minutes_late": {
        "type": "number",
        "description": "How many minutes late the employee is"
      },
      "reason": {
        "type": "string",
        "description": "Reason for being late"
      }
    },
    "required": ["employee_id", "minutes_late", "reason"]
  }
}
```

#### Function 4: check_threshold_status
```json
{
  "name": "check_threshold_status",
  "description": "Check if employee is approaching attendance thresholds and needs coaching",
  "parameters": {
    "type": "object",
    "properties": {
      "employee_id": {
        "type": "string",
        "description": "Employee ID from their record"
      }
    },
    "required": ["employee_id"]
  }
}
```

### Step 3: Configure Webhook for Post-Call Processing

1. In VAPI dashboard, find **Webhook URL** or **Post-Call Webhook**
2. Enter: `https://your-domain.com/api/calls/vapi-webhook`
3. This webhook receives the complete call data after the call ends

### Step 4: Test with ngrok (Local Development)

If testing locally before deploying:

```bash
# Install ngrok (if not already installed)
npm install -g ngrok

# Start your server
npm run dev

# In another terminal, expose your local server
ngrok http 3000

# Copy the ngrok URL (e.g., https://abc123.ngrok.io)
# Use this URL in VAPI dashboard:
# Function URL: https://abc123.ngrok.io/api/calls/vapi-function
# Webhook URL: https://abc123.ngrok.io/api/calls/vapi-webhook
```

### Step 5: Update Environment Variables

Add to your `.env` file:

```bash
# VAPI Configuration
VAPI_PHONE_NUMBER=+1234567890  # Your VAPI phone number
VAPI_API_KEY=your_vapi_api_key_here  # From VAPI dashboard
VAPI_WEBHOOK_SECRET=your_webhook_secret  # For security
```

### Step 6: Test the Integration

1. **Test Employee Lookup:**
   - Call your VAPI number
   - Say your name
   - AI should look you up and confirm your work station

2. **Test Absence Logging:**
   - Tell the AI you're sick
   - Provide reason
   - Check `/admin/manage` to see if absence was logged

3. **Check Database:**
   - Go to `/dashboard`
   - Verify employee points increased
   - Check "Recent Absences" section

## How It Works - Call Flow

### During the Call:

```
1. Employee calls VAPI number
   ↓
2. AI: "Hi, who am I speaking with?"
   ↓
3. Employee: "John Smith"
   ↓
4. AI calls get_employee_record(name: "John Smith")
   → POST https://your-domain.com/api/calls/vapi-function
   → Your server queries MongoDB
   → Returns: {name, work_station, points, status}
   ↓
5. AI: "Hi John! I see you work at Station A and have 2 points.
        Are you calling because you're sick or late?"
   ↓
6. Employee: "I'm sick today"
   ↓
7. AI: "I'm sorry to hear that. What's the reason?"
   ↓
8. Employee: "I have the flu"
   ↓
9. AI calls check_threshold_status(employee_id: "EMP001")
   → Checks current points (2.0)
   → Returns: {status: "good", message: "Good standing"}
   ↓
10. AI calls log_absence(employee_id: "EMP001", type: "sick", reason: "flu")
    → Saves to database
    ↓
11. AI: "I've logged your absence. You now have 3 points.
         Feel better, and we'll see you when you return!"
    ↓
12. Call ends
    ↓
13. VAPI sends complete call data to webhook
    → POST https://your-domain.com/api/calls/vapi-webhook
    → Your server processes and finalizes record
    → Updates employee stats
```

## Troubleshooting

### AI Can't Look Up Employees

**Problem:** AI says "I can't find that employee"

**Solutions:**
1. Check server logs: `npm run dev` (look for function call errors)
2. Verify employee exists in database: `/admin/manage` → Employees tab
3. Test function directly:
   ```bash
   curl -X POST http://localhost:3000/api/calls/vapi-function \
     -H "Content-Type: application/json" \
     -d '{
       "functionName": "get_employee_record",
       "parameters": {"name": "John Smith"}
     }'
   ```

### Functions Not Being Called

**Problem:** AI doesn't call any functions

**Solutions:**
1. Verify Function URL is set in VAPI dashboard
2. Check ngrok is running (if testing locally)
3. Look at VAPI dashboard logs for function call attempts
4. Ensure functions are properly added in VAPI dashboard

### Webhook Not Receiving Data

**Problem:** Call completes but no data saved

**Solutions:**
1. Check webhook URL is correct in VAPI dashboard
2. Look at server logs for webhook POST requests
3. Verify route is mounted: `app.use('/api/calls', require('./routes/calls'));`
4. Test webhook directly:
   ```bash
   curl -X POST http://localhost:3000/api/calls/vapi-webhook \
     -H "Content-Type: application/json" \
     -d '{
       "transcript": "Test call",
       "functionCalls": [{
         "name": "log_absence",
         "parameters": {
           "employee_id": "EMP001",
           "type": "sick",
           "reason": "Test",
           "work_station": "Line 1 - Station A"
         }
       }]
     }'
   ```

### Database Not Updating

**Problem:** Functions execute but database doesn't update

**Solutions:**
1. Check MongoDB connection: Look for connection errors in console
2. Verify employee_id matches: Check `/admin/manage` for correct IDs
3. Look at Absence model: `models/Absence.js`
4. Check server logs for database errors

## Security Considerations

### Webhook Authentication

Add webhook signature verification:

```javascript
// In routes/calls.js
router.post('/vapi-webhook', async (req, res) => {
  // Verify webhook signature
  const signature = req.headers['x-vapi-signature'];
  const secret = process.env.VAPI_WEBHOOK_SECRET;

  // Verify signature matches
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Continue processing...
});
```

### Rate Limiting

Add rate limiting to prevent abuse:

```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

const vapiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10 // 10 requests per minute
});

router.post('/vapi-function', vapiLimiter, async (req, res) => {
  // Your function handler
});
```

## Production Deployment

### Prerequisites:
1. Domain name with SSL certificate
2. Server deployed (Heroku, Railway, AWS, etc.)
3. MongoDB Atlas (cloud database)
4. Environment variables configured

### Steps:
1. Deploy your server to production
2. Update VAPI dashboard URLs to production domain
3. Set environment variables on server
4. Test with real phone calls
5. Monitor logs for any issues

## Monitoring & Logs

### Check Server Logs:
```bash
# View real-time logs
npm run dev

# Look for:
# "VAPI function call: get_employee_record { name: 'John Smith' }"
# "Absence logged for John Smith: sick - flu"
# "Vapi webhook received: {...}"
```

### Check VAPI Dashboard:
1. Go to VAPI dashboard
2. Click "Calls" or "Call Logs"
3. View transcripts and function calls
4. Check for errors in function execution

### Check Database:
```bash
# Connect to MongoDB
mongosh "your_mongodb_uri"

# Check recent absences
db.absences.find().sort({date: -1}).limit(5)

# Check employee stats
db.employees.findOne({name: "John Smith"})
```

## Summary

✅ **VAPI Dashboard** = AI conversation interface
✅ **vapiService.js** = Your business logic
✅ **routes/calls.js** = Webhook handlers
✅ **Function URL** = Real-time function execution
✅ **Webhook URL** = Post-call processing

**Key URLs to Configure:**
- Function Server: `https://your-domain.com/api/calls/vapi-function`
- Webhook: `https://your-domain.com/api/calls/vapi-webhook`

Once configured, your AI assistant will be able to:
- Look up employees by name or phone
- Log absences and tardies automatically
- Check attendance thresholds
- Provide real-time feedback to employees
- Save all data to your database

## Need Help?

Check logs at each step:
1. VAPI dashboard call logs
2. Your server console logs
3. MongoDB database records

If stuck, test each component individually using curl commands provided above.
