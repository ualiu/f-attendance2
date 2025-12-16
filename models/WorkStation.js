const mongoose = require('mongoose');

const workStationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  line: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },

  // Shift-based assignments
  shifts: {
    day: {
      primary_worker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
      },
      backup_workers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
      }]
    },
    night: {
      primary_worker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
      },
      backup_workers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
      }]
    },
    weekend: {
      primary_worker: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
      },
      backup_workers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee'
      }]
    }
  },

  // Operational status tracking
  is_operational: {
    type: Boolean,
    default: true
  },
  last_status_change: {
    type: Date,
    default: Date.now
  },
  downtime_history: [{
    went_down_at: {
      type: Date,
      required: true
    },
    came_back_up_at: {
      type: Date,
      default: null
    },
    duration_minutes: {
      type: Number,
      default: 0
    },
    reason: {
      type: String,
      default: ''
    },
    resolution_notes: {
      type: String,
      default: ''
    }
  }],
  total_downtime_minutes: {
    type: Number,
    default: 0
  },

  // Legacy fields (for backward compatibility - can be removed later)
  primary_worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    default: null
  },
  backup_workers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }],

  required_for_production: {
    type: Boolean,
    default: true
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
workStationSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model('WorkStation', workStationSchema);
