'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('../config');
const logger = require('../utils/logger');
const { streamJobAsZip } = require('../services/flipbookBuilder');
const { downloadLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'flipbook.html');

/**
 * GET /api/download/:jobId
 * Streams a self-contained ZIP containing an offline-ready flipbook.
 */
router.get('/:jobId', downloadLimiter, async (req, res, next) => {
  const { jobId } = req.params;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(jobId)) {
    return res.status(400).json({ error: 'Invalid job id' });
  }
  const jobDir = path.join(config.outputDir, jobId);
  if (!fs.existsSync(path.join(jobDir, 'manifest.json'))) {
    return res.status(404).json({ error: 'Flipbook not found' });
  }
  try {
    await streamJobAsZip({
      jobDir,
      jobId,
      res,
      templatePath: TEMPLATE_PATH,
      title: req.query.title,
    });
  } catch (err) {
    logger.error(`ZIP stream failed for ${jobId}:`, err);
    if (!res.headersSent) next(err);
    else res.end();
  }
});

module.exports = router;
