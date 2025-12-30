# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Felton Attendance is an AI-powered attendance management system for Felton Brushes. Employees report absences via SMS, which are parsed by Claude AI to create structured attendance records. Supervisors manage employees and view reports through a web dashboard.

**Stack:** Node.js, Express, MongoDB (Mongoose), EJS templates, Twilio (SMS), Claude AI (Anthropic SDK)
**Building Framework** MVC

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Development server with hot reload (port 3000)
npm start            # Production server
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  SMS (Twilio) → /api/sms/incoming → smsService.js (Claude)  │
│                         ↓                                    │
│              Absence record created in MongoDB               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Web Dashboard (EJS) ← Express Routes ← Services ← MongoDB  │
└─────────────────────────────────────────────────────────────┘
```

### Key Services

- **smsService.js** - Core SMS parsing with Claude AI. Handles conversation state for multi-message interactions. Contains detailed prompts for interpreting informal employee messages.
- **claudeService.js** - Report generation using Claude for employee/team analytics
- **attendanceService.js** - Attendance calculations, shift time logic, policy checks

### Multi-Tenancy (Critical)

All data is scoped by `organization_id`. Always use helpers from `utils/tenantHelper.js`:

```javascript
const { scopeQuery, validateTenantAccess } = require("../utils/tenantHelper");

// Querying - always scope to organization
const employees = await Employee.find(scopeQuery(req.organizationId));

// Accessing single resource - validate tenant ownership
const employee = await validateTenantAccess(Employee, id, req.organizationId);
```

### Authentication Middleware

Use `requireTenantAuth` for protected routes (combines: authenticated + active + organization attached):

```javascript
const { requireTenantAuth } = require("../middleware/auth");
router.use(requireTenantAuth);
```

Role-based: `ensureAdmin`, `ensureSuperAdmin` from same file.

## Data Models

| Model             | Purpose                                                  |
| ----------------- | -------------------------------------------------------- |
| Employee          | Employee profiles with phone, shift, organization_id     |
| Supervisor        | Admin accounts with role, organization_id                |
| Organization      | Tenant config including LLM settings, shift times        |
| Absence           | Attendance records with type, reason, points, transcript |
| ConversationState | SMS conversation context (15-min TTL)                    |

### Absence Types

**SMS-reported:** `sick`, `late`, `personal`
**Admin-logged:** `no_sms_no_show`, `late_sms_no_show`, `left_early_no_permission`, `left_early_permission`, `late_in_no_sms`

### Duration Classification

- LATE: < 2 hours (0.33 points)
- HALF_DAY: 2-4 hours (0.5 points)
- FULL_DAY: 4+ hours (1.0 point)

### Points System (Partially Implemented)

The points system is designed to track attendance issues per quarter:

**Status Thresholds:**
- 0-2.99 pts → Good Standing
- 3-3.99 pts → Watch
- 4-5.99 pts → At Risk
- 6+ pts → Formal Review Required

**What's Implemented:**
- Absence recording and duration classification (`smsService.js`)
- Policy violation detection for < 30 min notice (`attendanceService.js`)
- Points referenced in report generation (`claudeService.js`)

**What's Missing:**
- `points_current_quarter`, `status` fields not in Employee schema
- `points_awarded` field not in Absence schema
- No automatic point calculation when absences are logged
- No status auto-update based on point thresholds
- No points display in dashboard UI

**Key Files:**
- `services/smsService.js:735-747` - Duration classification logic
- `services/claudeService.js:42` - References points in reports (fields don't exist)
- `routes/employees.js:166-185` - Reset points endpoint (incomplete)

## Environment Variables

Required in `.env`:

- `MONGODB_URI` - MongoDB connection string
- `ANTHROPIC_API_KEY` - Claude AI API key
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` - SMS config
- `SESSION_SECRET` - Express session secret
- `PORT` - Server port (default 3000)

## Deployment

**Hosted on:** [Railway.app](https://railway.app)

- Production auto-deploys from `main` branch
- Environment variables configured in Railway dashboard
- Railway proxy is trusted in production (`server.js` trusts proxy for secure cookies)
- Twilio webhook URL points to Railway deployment

## SMS Flow

See `SMS_FLOW_EXAMPLES.md` for detailed conversation examples. Key points:

- Claude parses informal/typo-filled messages
- ConversationState maintains context for follow-up questions
- System asks only for missing information
- Conversations auto-expire after 15 minutes

## Known Gotchas

### Hidden Form Inputs Still Submit
Form inputs hidden with CSS (`display: none`) still submit their values. When using preset dropdowns with hidden custom inputs, check for the preset value explicitly:

```javascript
// Wrong - hidden inputs still have values
if (startDate && endDate) { ... }

// Right - only use custom dates when explicitly selected
if (range === 'custom' && startDate && endDate) { ... }
```

### Date Range Queries
MongoDB stores dates in UTC. Always use `Date.UTC()` for date range calculations:

```javascript
const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
```

## Claude Code Tools

Custom subagents and skills in `.claude/`:

| Tool | Type | Purpose |
|------|------|---------|
| dead-code-analyzer | Subagent | Find unused code (read-only) |
| dead-code-cleaner | Subagent | Remove confirmed dead code |
| debugger | Subagent | Systematic bug debugging |
| feature-explainer | Subagent | Explain how features work |
| brainstorm | Subagent | Explore ideas and creative applications |
| claude-md-updater | Skill | Guide for updating this file |
| market-insights | Skill | User feedback, positioning, go-to-market strategy |
| brainstorming-frameworks | Skill | Frameworks for better idea generation |
