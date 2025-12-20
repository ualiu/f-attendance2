const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const supervisorSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true
  },
  password_hash: {
    type: String,
    required: true
  },

  // Role & permissions
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'supervisor', 'manager'],
    default: 'supervisor'
  },
  department: {
    type: String,
    default: null
  },

  // Multi-tenancy: Organization reference
  organization_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: false, // Will be required after migration
    index: true
  },

  // Access control
  is_active: {
    type: Boolean,
    default: true
  },
  first_login: {
    type: Date,
    default: null
  },
  last_login: {
    type: Date,
    default: null
  },

  // Notification preferences
  email_notifications: {
    type: Boolean,
    default: true
  },
  sms_notifications: {
    type: Boolean,
    default: false
  },
  phone: {
    type: String,
    default: null
  },

  // Admin invitation management
  password_reset_required: {
    type: Boolean,
    default: false
  },
  invitation_token: {
    type: String,
    default: null
  },
  invitation_expires: {
    type: Date,
    default: null
  },

  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
});

// Update the updated_at timestamp before saving
supervisorSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

// Method to compare password
supervisorSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password_hash) {
    return false;
  }
  return await bcrypt.compare(candidatePassword, this.password_hash);
};

// Static method to hash password
supervisorSchema.statics.hashPassword = async function(password) {
  return await bcrypt.hash(password, 10);
};

module.exports = mongoose.model('Supervisor', supervisorSchema);
