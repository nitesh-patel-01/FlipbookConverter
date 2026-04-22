'use strict';

const rateLimit = require('express-rate-limit');

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload rate limit reached. Please wait a few minutes.' },
});

const downloadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Download rate limit reached. Please wait a few minutes.' },
});

module.exports = { uploadLimiter, downloadLimiter };
