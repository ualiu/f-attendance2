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
  if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
    return next();
  }
  res.status(403).send('Access denied - Admin only');
};

// Ensure user is super admin (highest level)
exports.ensureSuperAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'super_admin') {
    return next();
  }
  res.status(403).send('Access denied - Super Admin only');
};

// Attach organization context to request
exports.attachOrganization = (req, res, next) => {
  if (req.user && req.user.organization_id) {
    // Store organization ID for easy access in routes
    req.organizationId = req.user.organization_id;
    return next();
  }

  // User has no organization (shouldn't happen after migration)
  console.error('User has no organization_id:', req.user?.email);
  res.status(500).send('User account not properly configured. Please contact support.');
};

// Combined middleware for protected routes
exports.requireAuth = [
  exports.ensureAuthenticated,
  exports.ensureActive
];

// Combined middleware for tenant-scoped routes (most routes should use this)
exports.requireTenantAuth = [
  exports.ensureAuthenticated,
  exports.ensureActive,
  exports.attachOrganization
];
