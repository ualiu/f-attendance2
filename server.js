require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const passport = require('./config/passport');
const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const path = require('path');

const app = express();

// Trust Railway proxy (for secure cookies and sessions)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Connect to MongoDB
connectDB();

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log ALL incoming requests to /api/absences/*
app.use('/api/absences', (req, res, next) => {
  console.log(`\n📥 INCOMING REQUEST TO ${req.method} ${req.path}`);
  console.log(`   Headers:`, req.headers);
  console.log(`   Body:`, req.body);
  next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'stafflogix-secret-key-change-this',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    touchAfter: 24 * 3600, // Lazy update session every 24 hours
    ttl: 7 * 24 * 60 * 60 // 7 days
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined
  },
  proxy: process.env.NODE_ENV === 'production' // Trust Railway proxy
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Flash messages
app.use(flash());

// Make user and organization available to all views
app.use(async (req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.error = req.query.error || req.flash('error')[0] || null;
  res.locals.success = req.query.success || req.flash('success')[0] || null;

  // Load organization if user is authenticated
  if (req.user && req.user.organization_id) {
    try {
      const Organization = require('./models/Organization');
      const organization = await Organization.findById(req.user.organization_id);
      res.locals.organization = organization;
    } catch (error) {
      console.error('Error loading organization:', error);
      res.locals.organization = null;
    }
  } else {
    res.locals.organization = null;
  }

  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/admin', require('./routes/admin'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/absences', require('./routes/absences'));
app.use('/api/organization', require('./routes/organization'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/coverage', require('./routes/coverage'));
app.use('/reports', require('./routes/reports'));

// Root route - landing page
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/dashboard');
  } else {
    res.render('landing');
  }
});

// Public contact page (target of both landing-page CTAs).
// Renders for signed-in users too - it is a marketing page, not gated.
app.get('/contact', (req, res) => {
  res.render('contact');
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: '404 - Page Not Found',
    message: 'The page you are looking for does not exist.'
  });
});

// Error handler
app.use(errorHandler);

// Shift coverage (Phase 3+) sends outbound SMS via the Twilio REST client, which
// needs the ACCOUNT SID (starts with "AC"), not an API Key SID (starts with "SK").
// Every Twilio interaction before this feature was an inbound-webhook TwiML reply,
// which never needed these credentials - so a wrong value here was invisible until now.
if (process.env.TWILIO_ACCOUNT_SID && !process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
  console.warn('\n⚠️  TWILIO_ACCOUNT_SID does not start with "AC" - it looks like an API Key SID.');
  console.warn('    Outbound SMS (shift coverage) will fail authentication until this is fixed.\n');
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 StaffLogix running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🔐 Login at: http://localhost:${PORT}/login\n`);

  // Only the live server starts the sweep - scripts that require services
  // directly (the test harnesses) never call this, so they can't accidentally
  // leave a background timer running.
  require('./services/coverageScheduler').start();
});
