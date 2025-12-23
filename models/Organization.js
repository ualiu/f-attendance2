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
    },
    shift_times: {
      day_start: {
        type: String,
        default: '07:00' // 7:00 AM
      },
      day_end: {
        type: String,
        default: '15:00' // 3:00 PM (8 hours)
      },
      night_start: {
        type: String,
        default: '19:00' // 7:00 PM
      },
      night_end: {
        type: String,
        default: '03:00' // 3:00 AM next day (8 hours)
      },
      weekend_start: {
        type: String,
        default: '08:00' // 8:00 AM
      },
      weekend_end: {
        type: String,
        default: '16:00' // 4:00 PM (8 hours)
      }
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
