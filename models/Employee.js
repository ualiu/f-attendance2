const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  employee_id: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  department: {
    type: String,
    required: true
  },
  work_station: {
    type: String,
    default: null
  },
  shift: {
    type: String,
    enum: ['Day (7am-3:30pm)', 'Afternoon (3:30pm-12am)', 'Night (12am-7am)'],
    required: true
  },
  supervisor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supervisor',
    default: null
  },

  // Attendance tracking
  points_current_quarter: {
    type: Number,
    default: 0
  },
  absences_this_quarter: {
    type: Number,
    default: 0
  },
  tardies_this_quarter: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['good', 'watch', 'at_risk', 'review_required'],
    default: 'good'
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
employeeSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model('Employee', employeeSchema);
