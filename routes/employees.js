const express = require('express');
const router = express.Router();
const { requireTenantAuth, ensureSuperAdmin } = require('../middleware/auth');
const { scopeQuery, validateTenantAccess } = require('../utils/tenantHelper');
const Employee = require('../models/Employee');
const Absence = require('../models/Absence');
const EmployeeNote = require('../models/EmployeeNote');
const attendanceService = require('../services/attendanceService');
const path = require('path');
const fs = require('fs');
const { ampDocumentUpload, FILE_TYPE_MAP } = require('../config/multer');

// All employee routes require authentication + tenant scoping
router.use(requireTenantAuth);

// Get all employees (tenant-scoped with pagination)
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100; // Default 100 per page
    const skip = (page - 1) * limit;

    const query = scopeQuery(req.organizationId);

    // Get total count for pagination metadata
    const total = await Employee.countDocuments(query);

    const employees = await Employee.find(query)
      .populate('supervisor_id')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      employees,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single employee (tenant-scoped)
router.get('/:id', async (req, res) => {
  try {
    const employee = await validateTenantAccess(Employee, req.params.id, req.organizationId);
    await employee.populate('supervisor_id');

    res.json({ success: true, employee });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create employee (tenant-scoped)
router.post('/', async (req, res) => {
  try {
    const { employee_id, name, phone, shift } = req.body;

    // Assign supervisor if authenticated user is a supervisor
    const supervisor_id = req.user._id;

    const employee = await Employee.create({
      employee_id,
      name,
      phone,
      shift,
      supervisor_id,
      organization_id: req.organizationId, // CRITICAL: Assign to user's organization
      points_current_quarter: 0,
      absences_this_quarter: 0,
      tardies_this_quarter: 0,
      status: 'good'
    });

    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update employee (tenant-scoped)
router.put('/:id', async (req, res) => {
  try {
    const updates = req.body;

    // Don't allow updating points/status directly (use attendance service)
    delete updates.points_current_quarter;
    delete updates.absences_this_quarter;
    delete updates.tardies_this_quarter;
    delete updates.status;
    delete updates.organization_id; // Prevent changing organization

    const employee = await Employee.findOneAndUpdate(
      scopeQuery(req.organizationId, { _id: req.params.id }),
      updates,
      { new: true, runValidators: true }
    ).populate('supervisor_id');

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete employee (tenant-scoped)
router.delete('/:id', async (req, res) => {
  try {
    const employee = await Employee.findOneAndDelete(
      scopeQuery(req.organizationId, { _id: req.params.id })
    );

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get employee absences (tenant-scoped)
router.get('/:id/absences', async (req, res) => {
  try {
    // First validate employee belongs to organization
    await validateTenantAccess(Employee, req.params.id, req.organizationId);

    const { startDate, endDate } = req.query;

    const query = scopeQuery(req.organizationId, { employee_id: req.params.id });

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const absences = await Absence.find(query)
      .sort({ date: -1 })
      .limit(100);

    res.json({ success: true, absences });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset employee points (for new quarter) - tenant-scoped
router.post('/:id/reset-points', async (req, res) => {
  try {
    const employee = await validateTenantAccess(Employee, req.params.id, req.organizationId);

    if (!employee) {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }

    employee.points_current_quarter = 0;
    employee.absences_this_quarter = 0;
    employee.tardies_this_quarter = 0;
    employee.status = 'good';

    await employee.save();

    res.json({ success: true, employee });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Bulk import employees (tenant-scoped)
router.post('/bulk-import', async (req, res) => {
  try {
    const { employees } = req.body;

    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({ success: false, error: 'No employees provided' });
    }

    // Assign supervisor and organization
    const supervisor_id = req.user._id;
    const organization_id = req.organizationId;

    // Add supervisor and organization_id to all employees
    const employeesWithOrgAndSupervisor = employees.map(emp => ({
      ...emp,
      supervisor_id,
      organization_id, // CRITICAL: Assign to user's organization
      points_current_quarter: 0,
      absences_this_quarter: 0,
      tardies_this_quarter: 0,
      status: 'good'
    }));

    const created = await Employee.insertMany(employeesWithOrgAndSupervisor);

    res.json({ success: true, count: created.length, employees: created });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// EMPLOYEE NOTES (AMP ENFORCEMENT TIMELINE)
// ============================================

// Get all notes for an employee (tenant-scoped)
router.get('/:id/notes', async (req, res) => {
  try {
    // Validate employee belongs to organization
    await validateTenantAccess(Employee, req.params.id, req.organizationId);

    const notes = await EmployeeNote.find(
      scopeQuery(req.organizationId, { employee_id: req.params.id })
    )
      .sort({ created_at: -1 }) // Newest first
      .limit(100);

    res.json({ success: true, notes });
  } catch (error) {
    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    console.error('Error fetching notes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create a new note with optional file uploads
router.post('/:id/notes', ampDocumentUpload.array('attachments', 5), async (req, res) => {
  try {
    const { content } = req.body;

    // Validate required fields
    if (!content) {
      // Clean up uploaded files if validation fails
      if (req.files) {
        req.files.forEach(file => fs.unlinkSync(file.path));
      }
      return res.status(400).json({
        success: false,
        error: 'Missing required field: content'
      });
    }

    // Validate employee belongs to organization
    const employee = await validateTenantAccess(Employee, req.params.id, req.organizationId);

    // Additional file validation - verify extension matches mimetype
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const expectedExt = FILE_TYPE_MAP[file.mimetype];
        const actualExt = path.extname(file.originalname).toLowerCase();

        if (expectedExt !== actualExt) {
          // Clean up all files
          req.files.forEach(f => fs.unlinkSync(f.path));
          return res.status(400).json({
            success: false,
            error: `File ${file.originalname} has mismatched extension`
          });
        }
      }
    }

    // Build attachments array from uploaded files
    const attachments = (req.files || []).map(file => ({
      filename: file.filename,
      original_name: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: `amp-documents/org_${req.organizationId}/${file.filename}`
    }));

    // Create note
    const note = await EmployeeNote.create({
      employee_id: employee._id,
      organization_id: req.organizationId,
      author_id: req.user._id,
      author_name: req.user.name || req.user.email,
      content,
      attachments,
      is_edited: false
    });

    console.log(`✅ NOTE CREATED:`);
    console.log(`   Employee: ${employee.name}`);
    console.log(`   Author: ${req.user.name || req.user.email}`);
    console.log(`   Attachments: ${attachments.length}`);

    res.json({
      success: true,
      note,
      message: 'Note created successfully'
    });
  } catch (error) {
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error('Error deleting file:', err);
        }
      });
    }

    if (error.message === 'Resource not found or access denied') {
      return res.status(404).json({ success: false, error: 'Employee not found' });
    }
    console.error('Error creating note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a note (super admin only, no file changes)
router.put('/:id/notes/:noteId', ensureSuperAdmin, async (req, res) => {
  try {
    const { content } = req.body;

    // Validate employee belongs to organization
    await validateTenantAccess(Employee, req.params.id, req.organizationId);

    // Validate note belongs to organization and employee
    const note = await EmployeeNote.findOne(
      scopeQuery(req.organizationId, {
        _id: req.params.noteId,
        employee_id: req.params.id
      })
    );

    if (!note) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }

    // Update fields
    if (content) note.content = content;
    note.is_edited = true;
    note.edited_at = new Date();

    await note.save();

    console.log(`✅ NOTE UPDATED by ${req.user.name || req.user.email}`);

    res.json({
      success: true,
      note,
      message: 'Note updated successfully'
    });
  } catch (error) {
    console.error('Error updating note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a note and its attachments (super admin only)
router.delete('/:id/notes/:noteId', ensureSuperAdmin, async (req, res) => {
  try {
    // Validate employee belongs to organization
    await validateTenantAccess(Employee, req.params.id, req.organizationId);

    // Find and validate note
    const note = await EmployeeNote.findOne(
      scopeQuery(req.organizationId, {
        _id: req.params.noteId,
        employee_id: req.params.id
      })
    );

    if (!note) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }

    // Delete associated files
    if (note.attachments && note.attachments.length > 0) {
      note.attachments.forEach(attachment => {
        try {
          const filePath = path.join(__dirname, '..', 'uploads', attachment.path);
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`   Deleted file: ${attachment.original_name}`);
          }
        } catch (err) {
          console.error(`Error deleting file ${attachment.original_name}:`, err);
        }
      });
    }

    // Delete note
    await note.deleteOne();

    console.log(`✅ NOTE DELETED by ${req.user.name || req.user.email}`);

    res.json({
      success: true,
      message: 'Note and attachments deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting note:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Download an attachment (tenant-scoped)
router.get('/:id/notes/:noteId/download/:filename', async (req, res) => {
  try {
    // Validate employee belongs to organization
    await validateTenantAccess(Employee, req.params.id, req.organizationId);

    // Validate note belongs to organization
    const note = await EmployeeNote.findOne(
      scopeQuery(req.organizationId, {
        _id: req.params.noteId,
        employee_id: req.params.id
      })
    );

    if (!note) {
      return res.status(404).json({ success: false, error: 'Note not found' });
    }

    // Find attachment in note
    const attachment = note.attachments.find(a => a.filename === req.params.filename);
    if (!attachment) {
      return res.status(404).json({ success: false, error: 'Attachment not found' });
    }

    // Build file path
    const filePath = path.join(__dirname, '..', 'uploads', attachment.path);

    // Check file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found on server' });
    }

    // Set headers for download
    res.setHeader('Content-Type', attachment.mimetype);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.original_name}"`);

    // Stream file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    console.log(`📥 File downloaded: ${attachment.original_name} by ${req.user.name || req.user.email}`);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
