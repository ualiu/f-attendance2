# Setup Checklist

## ✅ Initial Setup (5 minutes)

- [ ] **Install Node.js** (if not already installed)
  - Download from: https://nodejs.org
  - Version 16 or higher required

- [ ] **Install MongoDB** (if not already installed)
  - Download from: https://www.mongodb.com/try/download/community
  - OR use MongoDB Atlas (cloud): https://www.mongodb.com/cloud/atlas

- [ ] **Start MongoDB**
  ```bash
  mongod
  ```

- [ ] **Install Dependencies**
  ```bash
  npm install
  ```

- [ ] **Configure Environment**
  - Edit `.env` file (already created)
  - Minimum required: MongoDB URI is already set
  - Optional: Add API keys later

- [ ] **Start the Server**
  ```bash
  npm run dev
  ```
  OR double-click `start.bat` (Windows)

- [ ] **Create Admin Account**
  - Open browser: http://localhost:3000
  - Go to: http://localhost:3000/create-admin
  - Fill in your details
  - Login

## ✅ Basic Configuration (10 minutes)

- [ ] **Add Work Stations**
  1. Go to Admin → Manage
  2. Click Work Stations tab
  3. Add at least 2-3 stations:
     - Line 1 - Station A
     - Line 1 - Station B
     - Line 2 - Station A

- [ ] **Add Employees**
  1. Click Employees tab
  2. Add at least 2-3 test employees:
     - Name: John Smith
     - ID: FEL-001
     - Phone: +15195551234
     - Department: Production
     - Shift: Day (7am-3:30pm)

- [ ] **Assign Employees to Stations**
  1. Back to Work Stations tab
  2. Click Edit on each station
  3. Assign primary and backup workers

- [ ] **View Dashboard**
  - Click Dashboard in sidebar
  - Verify employees and stations appear

## ✅ Optional: API Setup (When Ready)

### Google OAuth (For Google Login)
- [ ] Create project at https://console.cloud.google.com
- [ ] Enable Google+ API
- [ ] Create OAuth 2.0 credentials
- [ ] Add redirect URI: `http://localhost:3000/auth/google/callback`
- [ ] Copy Client ID and Secret to `.env`

### Claude AI (For Reports)
- [ ] Get API key from https://console.anthropic.com
- [ ] Add to `.env`: `ANTHROPIC_API_KEY=your_key`
- [ ] Test: Go to Reports → Generate any report

### Twilio (For Phone System)
- [ ] Create account at https://www.twilio.com
- [ ] Buy a phone number
- [ ] Add credentials to `.env`
- [ ] Configure webhook (when deployed)

### Vapi AI (For Voice Assistant)
- [ ] Create account at https://vapi.ai
- [ ] Create assistant with provided config
- [ ] Add API key to `.env`
- [ ] Configure webhook (when deployed)

## ✅ Testing (5 minutes)

- [ ] **Test Dashboard**
  - View today's summary
  - Check all stats display correctly

- [ ] **Test Employee Management**
  - Add a new employee
  - Edit an existing employee
  - View employee detail page

- [ ] **Test Station Management**
  - Add a new station
  - Edit station assignments
  - View stations page

- [ ] **Test Reports** (if Claude API configured)
  - Generate employee report
  - Generate team report
  - Generate station report

## ✅ Production Deployment (When Ready)

- [ ] **Choose Hosting Platform**
  - Heroku (easiest)
  - Railway
  - Render
  - DigitalOcean

- [ ] **Set Environment Variables**
  - Copy all from `.env` to hosting platform
  - Change `NODE_ENV` to `production`
  - Use HTTPS URLs for callbacks

- [ ] **Deploy Application**
  - Push to Git repository
  - Connect to hosting platform
  - Deploy

- [ ] **Configure Phone Number**
  - Update Twilio webhook to production URL
  - Update Vapi webhook to production URL
  - Test with real phone call

- [ ] **Train Users**
  - Show supervisors the dashboard
  - Demonstrate report generation
  - Explain employee management

## 🎯 Success Criteria

You're ready to go live when:
- ✅ Dashboard loads and shows data
- ✅ Can add/edit employees and stations
- ✅ Reports generate successfully (if configured)
- ✅ Phone system connects (if configured)
- ✅ All supervisors have accounts
- ✅ All employees are in the system
- ✅ All stations are configured

## 📞 Need Help?

1. **Quick Setup**: See `QUICKSTART.md`
2. **Full Documentation**: See `README.md`
3. **Project Overview**: See `PROJECT_SUMMARY.md`
4. **Code Issues**: Check inline comments in source files

## 🎉 You're Done!

Once all checkboxes are complete, your system is ready to use!

**Next Steps**:
1. Monitor usage for first week
2. Gather supervisor feedback
3. Generate first weekly report
4. Adjust as needed

---

**Estimated Total Setup Time**: 20-30 minutes for basic system
**Full Setup with APIs**: 1-2 hours
