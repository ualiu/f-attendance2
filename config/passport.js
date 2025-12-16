const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LocalStrategy = require('passport-local').Strategy;
const Supervisor = require('../models/Supervisor');

// Google OAuth Strategy
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user exists
      let supervisor = await Supervisor.findOne({ google_id: profile.id });

      if (!supervisor) {
        // Check if email exists (linking existing account)
        supervisor = await Supervisor.findOne({ email: profile.emails[0].value });

        if (supervisor) {
          // Link Google account to existing supervisor
          supervisor.google_id = profile.id;
          supervisor.profile_picture = profile.photos[0]?.value;
          supervisor.last_login = new Date();
          await supervisor.save();
        } else {
          // Create new supervisor (auto-registration)
          supervisor = await Supervisor.create({
            google_id: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            profile_picture: profile.photos[0]?.value,
            role: 'supervisor', // Default role
            is_active: true,
            first_login: new Date(),
            last_login: new Date()
          });

          console.log(`New supervisor registered: ${supervisor.email}`);
        }
      } else {
        // Update last login
        supervisor.last_login = new Date();
        await supervisor.save();
      }

      return done(null, supervisor);
    } catch (error) {
      return done(error, null);
    }
  }
));

// Local Strategy (for email/password login)
passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
  },
  async (email, password, done) => {
    try {
      const supervisor = await Supervisor.findOne({ email });

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
