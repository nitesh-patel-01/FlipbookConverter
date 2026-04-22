'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { nanoid } = require('nanoid');

const config = require('../config');
const { sanitizeFilename } = require('../utils/validator');

fs.mkdirSync(config.uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const safeName = sanitizeFilename(file.originalname);
    cb(null, `${Date.now()}-${nanoid(8)}-${safeName}`);
  },
});

/**
 * First-pass MIME filter using the declared mimetype.
 * `validateFile()` performs stricter magic-byte verification after write.
 */
function fileFilter(_req, file, cb) {
  if (!config.allowedMimeTypes.includes(file.mimetype)) {
    const err = new Error(
      `Unsupported file type: ${file.mimetype}. Allowed: PDF, JPG, PNG.`
    );
    err.status = 415;
    return cb(err, false);
  }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!config.allowedExtensions.includes(ext)) {
    const err = new Error(`Unsupported extension: ${ext}`);
    err.status = 415;
    return cb(err, false);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxUploadSizeBytes,
    files: 20, // max 20 images in one go
  },
});

module.exports = upload;
