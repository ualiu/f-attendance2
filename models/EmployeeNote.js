const mongoose = require('mongoose');

const employeeNoteSchema = new mongoose.Schema({
  // Foreign keys
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
    index: true
  },
  organization_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  author_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supervisor',
    required: true
  },

  // Denormalized for display performance
  author_name: {
    type: String,
    required: true
  },

  // Note content
  content: {
    type: String,
    required: true,
    maxlength: 5000
  },

  // File attachments
  attachments: [{
    filename: String,           // Server filename: 1703012345678-abc123.pdf
    original_name: String,      // User's filename: "Warning Letter.pdf"
    mimetype: String,           // 'application/pdf'
    size: Number,               // File size in bytes
    path: String,               // Relative path: "amp-documents/org_123/..."
    uploaded_at: {
      type: Date,
      default: Date.now
    }
  }],

  // Edit tracking
  is_edited: {
    type: Boolean,
    default: false
  },
  edited_at: {
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

// Compound indexes for tenant-scoped queries
employeeNoteSchema.index({ organization_id: 1, employee_id: 1, created_at: -1 });

// Update timestamp on save
employeeNoteSchema.pre('save', function(next) {
  this.updated_at = Date.now();
  next();
});

module.exports = mongoose.model('EmployeeNote', employeeNoteSchema);
