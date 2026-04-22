'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('../config');
const logger = require('../utils/logger');
const {
  streamJobAsZip,
  renderSingleFileHtml,
  readManifest,
} = require('../services/flipbookBuilder');
const { downloadLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'flipbook.html');

/**
 * GET /api/download/:jobId
 * Streams a ZIP (HTML + pages folder + README).
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

/**
 * GET /api/download/:jobId/single
 * Streams a single self-contained HTML file (base64-embedded images +
 * inlined jQuery + turn.js). Perfect for sharing one file via WhatsApp/email.
 */
router.get('/:jobId/single', downloadLimiter, async (req, res, next) => {
  const { jobId } = req.params;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(jobId)) {
    return res.status(400).json({ error: 'Invalid job id' });
  }
  const jobDir = path.join(config.outputDir, jobId);
  if (!fs.existsSync(path.join(jobDir, 'manifest.json'))) {
    return res.status(404).json({ error: 'Flipbook not found' });
  }
  try {
    const manifest = await readManifest(jobDir);
    const title = req.query.title || manifest.title || 'My Flipbook';
    const html = await renderSingleFileHtml(TEMPLATE_PATH, {
      title,
      jobDir,
      manifest,
    });
    const safe = String(title).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'flipbook';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safe}.html"`
    );
    res.send(html);
  } catch (err) {
    logger.error(`Single-file render failed for ${jobId}:`, err);
    if (!res.headersSent) next(err);
    else res.end();
  }
});

module.exports = router;
