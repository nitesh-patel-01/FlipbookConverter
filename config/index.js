'use strict';

const path = require('path');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

/**
 * Centralised configuration loaded from environment variables.
 * All size values are in bytes.
 */
module.exports = {
  env,
  isProd,

  port: parseInt(process.env.PORT, 10) || 3000,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // Storage
  uploadDir: path.resolve(process.env.UPLOAD_DIR || 'storage/uploads'),
  outputDir: path.resolve(process.env.OUTPUT_DIR || 'storage/output'),

  // Upload limits
  maxUploadSizeMB: parseInt(process.env.MAX_UPLOAD_SIZE_MB, 10) || 50,
  get maxUploadSizeBytes() {
    return this.maxUploadSizeMB * 1024 * 1024;
  },
  allowedMimeTypes: [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
  ],
  allowedExtensions: ['.pdf', '.jpg', '.jpeg', '.png'],

  // PDF rendering
  pdf: {
    density: parseInt(process.env.PDF_DENSITY, 10) || 150, // DPI
    format: 'jpeg',
    width: parseInt(process.env.PDF_PAGE_WIDTH, 10) || 1240,
    height: parseInt(process.env.PDF_PAGE_HEIGHT, 10) || 1754, // A4 @ ~150dpi
    maxPages: parseInt(process.env.PDF_MAX_PAGES, 10) || 300,
    concurrency: parseInt(process.env.PDF_CONCURRENCY, 10) || 2,
    chunkSize: parseInt(process.env.PDF_CHUNK_SIZE, 10) || 5, // pages per chunk
  },

  // Image optimisation
  image: {
    quality: parseInt(process.env.IMAGE_QUALITY, 10) || 82,
    maxWidth: parseInt(process.env.IMAGE_MAX_WIDTH, 10) || 1400,
    thumbWidth: 400,
  },

  // Auto cleanup (ms)
  cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS, 10) || 30 * 60 * 1000,
  fileTtlMs: parseInt(process.env.FILE_TTL_MS, 10) || 2 * 60 * 60 * 1000, // 2h
};
