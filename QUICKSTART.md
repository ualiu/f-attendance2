# Quick Start Guide - Felton Brushes Attendance System

## Getting Started in 5 Minutes

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Set Up Environment
Create a `.env` file:
```bash
cp .env.example .env
```

Edit `.env` with your settings (minimum required):
```
MONGODB_URI=mongodb://localhost:27017/felton-attendance
SESSION_SECRET=your-random-secret-here
PORT=3000
```

### Step 3: Start MongoDB
```bash
# If using local MongoDB
mongod

# Or use MongoDB Atlas (cloud)
# Just update MONGODB_URI with your Atlas connection string
```

### Step 4: Start the Application
```bash
npm run dev
```

### Step 5: Create Admin Account
1. Open browser to `http://localhost:3000`
2. Go to `/create-admin`
3. Create your first admin account:
   - Name: Mike Johnson
   - Email: mike@feltonbrushes.com
   - Password: (choose a secure password)
   - Department: Production

### Step 6: Add Test Data
1. Login with your admin account
2. Go to **Admin → Manage**
3. Click **Work Stations** tab
4. Add a test station:
   - Line: Line 1
   - Station: Station A
   - Department: Production
   - Critical: Yes

5. Click **Employees** tab
6. Add a test employee:
   - Name: John Smith
   - Employee ID: FEL-001
   - Phone: +15195551234
   - Department: Production
   - Shift: Day (7am-3:30pm)

### Step 7: View Dashboard
Go to **Dashboard** to see your system in action!

---

## Testing Without External APIs

You can test the system without Twilio, Vapi, or Claude by:

1. **Skip API setup** - Leave those environment variables empty
2. **Use the dashboard** - All dashboard features work without APIs
3. **Manually create absences** - Use MongoDB to insert test absence records

### Create Test Absence
```javascript
// In MongoDB shell or Compass
db.absences.insertOne({
  employee_id: ObjectId("your-employee-id"),
  employee_name: "John Smith",
  work_station: "Line 1 - Station A",
  date: new Date(),
  type: "sick",
  reason: "Flu symptoms",
  call_time: new Date(),
  points_awarded: 1.0,
  created_at: new Date()
})
```

---

## Next Steps

### To Enable Phone System:
1. Get Twilio account and phone number
2. Configure Twilio webhook to point to your server
3. Get Vapi account and create assistant
4. Update `.env` with Twilio and Vapi credentials

### To Enable AI Reports:
1. Get Anthropic API key from [console.anthropic.com](https://console.anthropic.com)
2. Add to `.env`: `ANTHROPIC_API_KEY=your-key`
3. Go to Reports page and generate your first report

### To Enable Google Login:
1. Set up Google OAuth (see README.md)
2. Add credentials to `.env`
3. Users can now login with Google

---

## Common Issues

### MongoDB Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:27017
```
**Solution**: Start MongoDB with `mongod`

### Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3000
```
**Solution**: Change PORT in `.env` or kill the process using port 3000

### Session Secret Warning
**Solution**: Set a secure SESSION_SECRET in `.env`

---

## Project Structure Quick Reference

```
felton-attendance/
├── models/          # Database schemas
├── routes/          # API endpoints
├── services/        # Business logic
├── views/           # EJS templates
├── public/          # CSS and JS
└── server.js        # Main app
```

## Default Login (After Setup)
- URL: `http://localhost:3000/login`
- Email: (your admin email)
- Password: (your admin password)

---

## Support

Need help? Check:
- Full documentation: [README.md](README.md)
- Environment setup: [.env.example](.env.example)

Enjoy your new attendance system! 🎉
