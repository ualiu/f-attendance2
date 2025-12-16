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
