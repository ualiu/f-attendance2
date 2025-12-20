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
    required: true,
    unique: true,
    trim: true
  },
  shift: {
    type: String,
    enum: ['Day', 'Night', 'Weekend'],
    required: true
  },

  // Employee details
  start_date: {
    type: Date,
    default: null
  },

  supervisor_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supervisor',
    default: null
  },

  // Multi-tenancy: Organization reference
  organization_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: false, // Will be required after migration
    index: true
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

// Compound indexes for tenant-scoped queries
employeeSchema.index({ organization_id: 1, employee_id: 1 });
employeeSchema.index({ organization_id: 1, phone: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
