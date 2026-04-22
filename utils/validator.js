'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

// file-type v16 is CommonJS-compatible
const FileType = require('file-type');

/**
 * Validate a file's actual MIME type via magic bytes (not just extension).
 * @param {string} filePath
 * @returns {Promise<{ok: boolean, mime?: string, ext?: string, reason?: string}>}
 */
async function validateFile(filePath) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) return { ok: false, reason: 'Empty file' };
    if (stat.size > config.maxUploadSizeBytes) {
      return { ok: false, reason: 'File exceeds size limit' };
    }

    const ext = path.extname(filePath).toLowerCase();
    if (!config.allowedExtensions.includes(ext)) {
      return { ok: false, reason: 'Disallowed extension' };
    }

    const detected = await FileType.fromFile(filePath);
    if (!detected) {
      return { ok: false, reason: 'Could not detect file type' };
    }

    if (!config.allowedMimeTypes.includes(detected.mime)) {
      return { ok: false, reason: `Disallowed MIME type: ${detected.mime}` };
    }

    // Make sure the magic-byte extension lines up sensibly
    const extMatch =
      ext === '.jpg' || ext === '.jpeg'
        ? ['jpg', 'jpeg']
        : [ext.replace('.', '')];
    if (!extMatch.includes(detected.ext)) {
      return {
        ok: false,
        reason: `Extension/content mismatch (${ext} vs .${detected.ext})`,
      };
    }

    return { ok: true, mime: detected.mime, ext: detected.ext };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Sanitise a user-supplied filename for safe disk usage.
 */
function sanitizeFilename(name) {
  return (name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 80);
}

module.exports = { validateFile, sanitizeFilename };
