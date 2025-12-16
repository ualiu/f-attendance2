const mongoose = require('mongoose');

const absenceSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  employee_name: {
    type: String,
    required: true
  },
  work_station: {
    type: String,
    required: true
  },

  date: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    enum: ['sick', 'late', 'personal', 'approved_pto'],
    required: true
  },
  reason: {
    type: String,
    required: true
  },
  expected_return: {
    type: Date,
    default: null
  },

  // Call details
  call_time: {
    type: Date,
    required: true
  },
  call_duration: {
    type: Number,
    default: 0
  },
  call_recording_url: {
    type: String,
    default: null
  },
  call_transcript: {
    type: String,
    default: null
  },

  // Attendance tracking
  points_awarded: {
    type: Number,
    required: true
  },

  // AI insights
  ai_notes: {
    type: String,
    default: null
  },
  coaching_offered: {
    type: Boolean,
    default: false
  },
  employee_response: {
    type: String,
    default: null
  },

  // Notifications
  supervisor_notified: {
    type: Boolean,
    default: false
  },
  notification_sent_at: {
    type: Date,
    default: null
  },

  // Additional flags
  late_notice: {
    type: Boolean,
    default: false
  },
  station_impacted: {
    type: Boolean,
    default: false
  },

  created_at: {
    type: Date,
    default: Date.now
  }
});

// Index for faster queries
absenceSchema.index({ employee_id: 1, date: -1 });
absenceSchema.index({ work_station: 1, date: -1 });
absenceSchema.index({ date: -1 });

module.exports = mongoose.model('Absence', absenceSchema);
