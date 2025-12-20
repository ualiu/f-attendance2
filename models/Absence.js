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

  // Multi-tenancy: Organization reference
  organization_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: false, // Will be required after migration
    index: true
  },

  date: {
    type: Date,
    required: true
  },
  type: {
    type: String,
    enum: [
      // SMS-based absences (automated)
      'sick',
      'late',
      'personal',
      // Manual admin-logged incidents (5 core edge cases)
      'no_sms_no_show',
      'late_sms_no_show',
      'left_early_no_permission',
      'left_early_permission',
      'late_in_no_sms'
    ],
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

  created_at: {
    type: Date,
    default: Date.now
  }
});

// Compound indexes for tenant-scoped queries
absenceSchema.index({ organization_id: 1, employee_id: 1, date: -1 });
absenceSchema.index({ organization_id: 1, date: -1 });

module.exports = mongoose.model('Absence', absenceSchema);
