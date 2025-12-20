const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const Supervisor = require('../models/Supervisor');

// Local Strategy (for email/password login)
passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
  },
  async (email, password, done) => {
    try {
      const supervisor = await Supervisor.findOne({ email: email.toLowerCase() });

      if (!supervisor) {
        return done(null, false, { message: 'Invalid email or password' });
      }

      if (!supervisor.is_active) {
        return done(null, false, { message: 'Account is disabled. Contact administrator.' });
      }

      const isMatch = await supervisor.comparePassword(password);

      if (!isMatch) {
        return done(null, false, { message: 'Invalid email or password' });
      }

      supervisor.last_login = new Date();
      await supervisor.save();

      return done(null, supervisor);
    } catch (error) {
      return done(error);
    }
  }
));

// Serialize user for session
passport.serializeUser((supervisor, done) => {
  done(null, supervisor.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const supervisor = await Supervisor.findById(id);
    done(null, supervisor);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
