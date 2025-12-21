const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const passport = require("../config/passport");
const {
  ensureAuthenticated,
  ensureSuperAdmin,
  requireTenantAuth,
} = require("../middleware/auth");
const Employee = require("../models/Employee");
const Supervisor = require("../models/Supervisor");
const Organization = require("../models/Organization");

// Show login page
router.get("/login", (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect("/dashboard");
  }
  res.render("auth/login");
});

// Local login (email/password)
router.post(
  "/auth/login",
  passport.authenticate("local", {
    failureRedirect: "/login?error=invalid_credentials",
    failureFlash: true,
  }),
  async (req, res) => {
    res.redirect("/dashboard");
  }
);

// Logout
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect("/login");
  });
});

// Create new organization and super admin account (multi-tenant signup)
router.get("/create-admin", async (req, res) => {
  try {
    res.render("auth/create-admin");
  } catch (error) {
    res.status(500).send("Server error");
  }
});

router.post("/create-admin", async (req, res) => {
  try {
    const { organization_name, name, email, password } = req.body;

    // Validate required fields
    if (!organization_name || !name || !email || !password) {
      return res.status(400).send("All fields are required");
    }

    // Check if email already exists (across all organizations)
    const existingUser = await Supervisor.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .send("An account with this email already exists. Please use a different email or login.");
    }

    // Check if organization name already exists
    const existingOrg = await Organization.findOne({ name: organization_name });
    if (existingOrg) {
      return res
        .status(400)
        .send("An organization with this name already exists. Please choose a different name.");
    }

    // Hash password
    const password_hash = await Supervisor.hashPassword(password);

    // CREATE ORGANIZATION FIRST (without super_admin_id initially)
    const organization = await Organization.create({
      name: organization_name,
      slug: organization_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      contact_email: email,
      super_admin_id: null, // Will update after creating supervisor
      settings: {
        max_admins: 10,
        max_employees: 500,
      },
    });

    console.log(`✅ Created organization: ${organization.name}`);

    // CREATE SUPER ADMIN with organization_id
    const superAdmin = await Supervisor.create({
      name,
      email,
      password_hash,
      role: "super_admin", // Super admin, not just admin
      organization_id: organization._id,
      is_active: true,
      first_login: new Date(),
    });

    console.log(`✅ Created super admin: ${superAdmin.email}`);

    // Update organization with super admin reference
    organization.super_admin_id = superAdmin._id;
    await organization.save();

    console.log(`✅ Linked organization to super admin`);

    // Auto-login
    req.login(superAdmin, (err) => {
      if (err) {
        console.error("Error logging in:", err);
        return res.status(500).send("Error logging in");
      }
      res.redirect("/dashboard");
    });
  } catch (error) {
    console.error("Error creating organization/admin:", error);
    res.status(500).send("Server error: " + error.message);
  }
});

// ========================================
// ADMIN INVITATION ROUTES (Super Admin Only)
// ========================================

// Show invite admin page
router.get(
  "/admin/invite-admin",
  requireTenantAuth,
  ensureSuperAdmin,
  async (req, res) => {
    try {
      // Get all admins in this organization
      const admins = await Supervisor.find({
        organization_id: req.organizationId,
        role: { $in: ["super_admin", "admin"] },
      }).sort({ created_at: -1 });

      // Get organization settings
      const Organization = require('../models/Organization');
      const organization = await Organization.findById(req.organizationId);

      res.render("admin/invite-admin", {
        user: req.user,
        admins,
        organization,
      });
    } catch (error) {
      console.error("Error loading invite admin page:", error);
      res.status(500).send("Server error");
    }
  }
);

// Create admin invitation (manual account creation with temp password)
router.post(
  "/admin/invite-admin",
  requireTenantAuth,
  ensureSuperAdmin,
  async (req, res) => {
    try {
      const { name, email, password } = req.body;

      // Validate
      if (!name || !email || !password) {
        return res.status(400).json({
          success: false,
          error: "Name, email, and password are required",
        });
      }

      // Check if email already exists in this organization
      const existing = await Supervisor.findOne({
        email,
        organization_id: req.organizationId,
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: "User with this email already exists in your organization",
        });
      }

      // Hash the provided password
      const password_hash = await Supervisor.hashPassword(password);

      // Create admin account
      const newAdmin = await Supervisor.create({
        name,
        email,
        password_hash,
        role: "admin", // Regular admin, not super_admin
        organization_id: req.organizationId,
        is_active: true,
        first_login: null,
      });

      console.log(`✅ Admin created: ${newAdmin.email} by ${req.user.email}`);

      res.json({
        success: true,
        admin: {
          _id: newAdmin._id,
          name: newAdmin.name,
          email: newAdmin.email,
          role: newAdmin.role,
        },
        message: "Admin account created successfully",
      });
    } catch (error) {
      console.error("Error inviting admin:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Delete/deactivate admin (super admin only)
router.post(
  "/admin/remove-admin/:id",
  requireTenantAuth,
  ensureSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Find admin in same organization
      const admin = await Supervisor.findOne({
        _id: id,
        organization_id: req.organizationId,
      });

      if (!admin) {
        return res.status(404).json({
          success: false,
          error: "Admin not found",
        });
      }

      // Prevent removing super admin
      if (admin.role === "super_admin") {
        return res.status(403).json({
          success: false,
          error: "Cannot remove super admin",
        });
      }

      // Deactivate instead of delete (preserve audit trail)
      admin.is_active = false;
      await admin.save();

      console.log(`✅ Admin deactivated: ${admin.email} by ${req.user.email}`);

      res.json({
        success: true,
        message: "Admin deactivated successfully",
      });
    } catch (error) {
      console.error("Error removing admin:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

module.exports = router;
