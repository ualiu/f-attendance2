const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Allowed file types
const ALLOWED_MIMETYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png'
];

const FILE_TYPE_MAP = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'image/jpeg': '.jpg',
  'image/png': '.png'
};

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create organization-specific directory
    const orgId = req.organizationId;
    if (!orgId) {
      return cb(new Error('Organization ID is required'));
    }

    const uploadPath = path.join(__dirname, '..', 'uploads', 'amp-documents', `org_${orgId}`);

    // Create directory if it doesn't exist
    fs.mkdirSync(uploadPath, { recursive: true });

    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Generate unique filename: timestamp-randomhex-sanitized-original
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname);
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');

    const filename = `${timestamp}-${randomString}-${safeName}${ext}`;
    cb(null, filename);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIMETYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG`), false);
  }
};

// Multer instance for AMP document uploads
const ampDocumentUpload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max per file
    files: 5 // Max 5 files per upload
  }
});

module.exports = {
  ampDocumentUpload,
  ALLOWED_MIMETYPES,
  FILE_TYPE_MAP
};
