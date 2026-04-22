'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('../config');
const { readManifest } = require('../services/flipbookBuilder');

const router = express.Router();

/**
 * GET /api/flipbook/:jobId
 * Returns the manifest (list of pages + metadata) used by the front-end to
 * build the live preview with turn.js.
 */
router.get('/:jobId', async (req, res, next) => {
  try {
    const { jobId } = req.params;
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(jobId)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const jobDir = path.join(config.outputDir, jobId);
    if (!fs.existsSync(path.join(jobDir, 'manifest.json'))) {
      return res.status(404).json({ error: 'Flipbook not found' });
    }
    const manifest = await readManifest(jobDir);
    const pages = manifest.pages.map((p) => ({
      ...p,
      url: `/output/${jobId}/${p.file}`,
      thumbUrl: `/output/${jobId}/${p.thumb}`,
    }));
    res.json({ ...manifest, pages });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
