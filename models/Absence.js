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

  // Report details (SMS or other contact method)
  report_time: {
    type: Date,
    required: true
  },
  report_method: {
    type: String,
    enum: ['sms', 'call', 'manual'],
    default: 'sms'
  },
  report_message: {
    type: String,
    default: null
  },

  // Attendance tracking
  points_awarded: {
    type: Number,
    required: true
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
