const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  contact_email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    default: null
  },
  address: {
    type: String,
    default: null
  },

  // Super admin reference
  super_admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supervisor',
    default: null
  },

  // Organization status
  is_active: {
    type: Boolean,
    default: true
  },

  // Settings
  settings: {
    max_admins: {
      type: Number,
      default: 10
    },
    max_employees: {
      type: Number,
      default: 500
    },
    llm_provider: {
      type: String,
      enum: ['claude', 'openai'],
      default: 'claude'
    },
    timezone: {
      type: String,
      default: 'America/New_York' // Eastern Time (ET)
    }
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

// Update timestamp on save
organizationSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model('Organization', organizationSchema);
