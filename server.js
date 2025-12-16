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

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'felton-attendance-secret-key-change-this',
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

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.error = req.query.error || req.flash('error')[0] || null;
  res.locals.success = req.query.success || req.flash('success')[0] || null;
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/setup'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/calls', require('./routes/calls'));
app.use('/reports', require('./routes/reports'));
app.use('/test', require('./routes/test'));

// Root redirect
app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/login');
  }
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Felton Attendance System running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`🔐 Login at: http://localhost:${PORT}/login\n`);
});
