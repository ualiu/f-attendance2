// Ensure user is authenticated
exports.ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Ensure user is active
exports.ensureActive = (req, res, next) => {
  if (req.user && req.user.is_active) {
    return next();
  }
  req.logout(() => {
    res.redirect('/login?error=account_disabled');
  });
};

// Ensure user is admin
exports.ensureAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Access denied - Admin only');
};

// Combined middleware for protected routes
exports.requireAuth = [
  exports.ensureAuthenticated,
  exports.ensureActive
];
