'use strict';

const multer = require('multer');
const logger = require('../utils/logger');

/**
 * Express error handler — maps known errors to predictable JSON responses.
 */
// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';

  if (err instanceof multer.MulterError) {
    status = 400;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File is too large. Please upload a smaller file.';
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      message = 'Too many files. Please upload fewer at a time.';
    } else {
      message = `Upload error: ${err.code}`;
    }
  }

  if (status >= 500) {
    logger.error('Request failed:', err);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} → ${status}: ${message}`);
  }

  res.status(status).json({
    error: message,
    code: err.code || undefined,
  });
};
