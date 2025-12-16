# Felton Brushes AI Attendance System

A complete AI-powered attendance management system for manufacturing companies. This system replaces traditional voicemail-to-email processes with an intelligent AI assistant that handles call-ins via phone, tracks attendance by work station, provides real-time dashboards, and generates AI-powered reports.

## Features

- **AI Voice Assistant**: Automated phone system using Vapi AI to handle employee call-ins
- **Real-time Dashboard**: Live attendance tracking with work station status
- **Smart Notifications**: Automatic supervisor notifications for critical absences
- **AI-Powered Reports**: Claude AI generates intelligent reports with pattern analysis
- **Work Station Management**: Track which production lines are affected by absences
- **Points System**: Automated tracking of attendance points and thresholds
- **Google OAuth**: Secure authentication with Google accounts
- **Mobile Responsive**: Access dashboard from any device

## Technology Stack

- **Backend**: Node.js + Express.js
- **Database**: MongoDB
- **Frontend**: EJS templates + vanilla JavaScript
- **APIs**:
  - Twilio (phone system)
  - Vapi (AI voice conversations)
  - Claude AI (intelligent reports)
  - Google OAuth (authentication)

## Prerequisites

- Node.js 16+ and npm
- MongoDB (local or Atlas)
- Twilio account (for phone system)
- Vapi account (for AI voice)
- Anthropic API key (for Claude AI)
- Google Cloud project (for OAuth)

## Installation

1. **Clone the repository**
   ```bash
   cd felton-attendance
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and fill in your credentials:
   ```
   MONGODB_URI=mongodb://localhost:27017/felton-attendance
   TWILIO_ACCOUNT_SID=your_twilio_sid
   TWILIO_AUTH_TOKEN=your_twilio_token
   TWILIO_PHONE_NUMBER=+19055223811
   VAPI_API_KEY=your_vapi_key
   ANTHROPIC_API_KEY=your_claude_key
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   SESSION_SECRET=your_random_secret_string
   ```

4. **Set up Google OAuth**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project
   - Enable Google+ API
   - Create OAuth 2.0 credentials
   - Add authorized redirect URI: `http://localhost:3000/auth/google/callback`
   - Copy Client ID and Secret to `.env`

5. **Start MongoDB**
   ```bash
   # If using local MongoDB
   mongod
   ```

6. **Run the application**
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```

7. **Access the application**
   - Open browser to `http://localhost:3000`
   - First time: Go to `/create-admin` to create admin account
   - Login and complete the setup wizard

## Setup Guide

### Initial Setup

1. **Create Admin Account**
   - Visit `/create-admin`
   - Enter name, email, password, and department
   - This creates the first admin user

2. **Add Work Stations**
   - Go to Admin → Manage → Work Stations tab
   - Click "+ Add Station"
   - Enter Line (e.g., "Line 1"), Station Name (e.g., "Station A")
   - Mark as "Critical for production" if needed
   - Repeat for all stations

3. **Add Employees**
   - Go to Admin → Manage → Employees tab
   - Click "+ Add Employee"
   - Enter employee details:
     - Name
     - Employee ID (e.g., "FEL-1234")
     - Phone number (for caller ID)
     - Department
     - Shift
   - Repeat for all employees

4. **Assign Employees to Stations**
   - Go to Work Stations tab
   - Click "Edit" on a station
   - Assign primary worker
   - Assign backup workers
   - Ensure critical stations have backup coverage

### Twilio Setup

1. **Get a phone number**
   - Log in to [Twilio Console](https://console.twilio.com)
   - Buy a phone number (e.g., (905) 522-3811 ext 8)

2. **Configure webhook**
   - In phone number settings, set webhook URL:
     - Voice: `https://your-domain.com/api/calls/incoming`
     - Method: POST

3. **Test the system**
   - Call your Twilio number
   - AI should answer and ask for your name
   - Test logging an absence

### Vapi AI Setup

1. **Create account** at [Vapi.ai](https://vapi.ai)

2. **Create assistant**
   - Use the configuration in `services/vapiService.js`
   - Configure functions for employee lookup and absence logging

3. **Set webhook**
   - Point Vapi webhook to: `https://your-domain.com/api/calls/vapi-webhook`

4. **Connect to Twilio**
   - Link your Twilio number to Vapi
   - Vapi will handle the AI conversation

## Usage

### For Supervisors

1. **Dashboard**
   - View today's attendance at a glance
   - See which employees are absent/late
   - Check which work stations are affected
   - Review recent calls

2. **Generate Reports**
   - Go to Reports page
   - Choose report type:
     - **Individual Employee**: Detailed analysis for one employee
     - **Team Report**: Overview of all employees
     - **Station Downtime**: Which stations are most affected
   - Select date range
   - Claude AI generates intelligent insights

3. **Manage System**
   - Add/edit employees
   - Add/edit work stations
   - Assign workers to stations
   - View employee attendance history

### For Employees

1. **Call In**
   - Call (905) 522-3811 ext 8
   - AI will greet you and ask for confirmation
   - State if calling out sick or late
   - Provide reason and expected return
   - AI will inform you of your current points status

2. **What AI Tracks**
   - Type of absence (sick, late, personal)
   - Reason
   - Expected return date
   - Current points (out of 6.0)
   - Offers coaching if approaching threshold

## Attendance Policy

- **6 absences in 90 days** = Formal review required
- **8 absences** = Termination review
- **3 tardies** (>15 min late) = 1 absence
- **30 minutes advance notice** required

### Points System

- **1.0 point**: Full day absence (sick or personal)
- **0.33 points**: Tardy (late arrival)
- **0.0 points**: Approved PTO (doesn't count)

### Status Levels

- **Good** (0-2 points): No concerns
- **Watch** (3 points): Monitor attendance
- **At Risk** (4-5 points): Proactive coaching offered
- **Review Required** (6+ points): Formal review scheduled

## API Endpoints

### Authentication
- `GET /login` - Login page
- `GET /auth/google` - Start Google OAuth
- `GET /auth/google/callback` - OAuth callback
- `POST /auth/login` - Email/password login
- `GET /logout` - Logout

### Dashboard
- `GET /dashboard` - Main dashboard
- `GET /dashboard/stations` - Work stations view
- `GET /dashboard/employee/:id` - Employee detail
- `GET /dashboard/api/data` - JSON data for refresh

### Calls
- `POST /api/calls/incoming` - Twilio webhook
- `POST /api/calls/vapi-webhook` - Vapi webhook
- `GET /api/calls` - List recent calls
- `GET /api/calls/:id/recording` - Get recording

### Employees
- `GET /api/employees` - List all employees
- `GET /api/employees/:id` - Get employee
- `POST /api/employees` - Create employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee
- `GET /api/employees/:id/absences` - Get absences

### Reports
- `GET /reports` - Reports page
- `POST /reports/employee` - Generate employee report
- `POST /reports/team` - Generate team report
- `POST /reports/stations` - Generate station report

### Admin
- `GET /admin/setup` - Setup wizard
- `GET /admin/manage` - Management page
- `POST /admin/stations` - Create station
- `PUT /admin/stations/:id` - Update station
- `DELETE /admin/stations/:id` - Delete station
- `POST /admin/stations/:id/assign` - Assign employee

## Deployment

### Heroku

```bash
# Install Heroku CLI
heroku login
heroku create felton-attendance

# Add MongoDB addon
heroku addons:create mongolab

# Set environment variables
heroku config:set TWILIO_ACCOUNT_SID=your_sid
heroku config:set TWILIO_AUTH_TOKEN=your_token
# ... set all other env vars

# Deploy
git push heroku main
```

### Railway

1. Connect GitHub repository
2. Add environment variables in dashboard
3. Deploy automatically on push

### Other Platforms

Works on any Node.js hosting:
- Render
- DigitalOcean App Platform
- AWS Elastic Beanstalk
- Google Cloud Run

## Troubleshooting

### MongoDB Connection Error
```bash
# Check if MongoDB is running
mongod --version

# Start MongoDB
mongod
```

### Twilio Not Receiving Calls
- Check webhook URL is correct and accessible
- Verify URL uses HTTPS (not HTTP) in production
- Check Twilio console for error logs

### Vapi Not Logging Absences
- Verify webhook URL in Vapi dashboard
- Check function calls are configured correctly
- Look at server logs for errors

### Google OAuth Fails
- Verify redirect URI matches exactly
- Check Client ID and Secret are correct
- Ensure Google+ API is enabled

## Development

### Project Structure
```
felton-attendance/
├── config/          # Configuration files
├── controllers/     # Route controllers (not used - logic in routes)
├── models/          # MongoDB models
├── routes/          # Express routes
├── services/        # Business logic services
├── middleware/      # Express middleware
├── views/           # EJS templates
├── public/          # Static files (CSS, JS)
├── server.js        # Main application file
└── package.json     # Dependencies
```

### Adding a New Feature

1. Create route in `routes/`
2. Add business logic to `services/`
3. Create view in `views/`
4. Update navigation in `views/partials/sidebar.ejs`

### Database Queries

```javascript
// Find all employees at risk
const atRisk = await Employee.find({
  status: { $in: ['at_risk', 'review_required'] }
});

// Get today's absences
const today = new Date();
today.setHours(0, 0, 0, 0);
const absences = await Absence.find({
  date: { $gte: today }
});
```

## Security

- All routes (except login) require authentication
- Passwords hashed with bcrypt
- Session stored in MongoDB
- HTTPS enforced in production
- Environment variables for secrets
- Input validation on all forms

## License

Proprietary - Felton Brushes Manufacturing

## Support

For questions or issues:
- Email: support@feltonbrushes.com
- Phone: (905) 522-3811

## Credits

Built with:
- [Express.js](https://expressjs.com)
- [MongoDB](https://www.mongodb.com)
- [Twilio](https://www.twilio.com)
- [Vapi AI](https://vapi.ai)
- [Claude AI](https://www.anthropic.com)
- [Passport.js](https://www.passportjs.org)
