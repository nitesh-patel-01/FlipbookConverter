'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('../config');
const logger = require('../utils/logger');
const {
  readManifest,
  renderStandaloneHtml,
} = require('../services/flipbookBuilder');

const router = express.Router();

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'flipbook.html');

/**
 * GET /view/:jobId
 * Public HTML page that renders the flipbook live, pulling page images
 * from /output/:jobId/. Intended for sharing via WhatsApp/email/etc.
 *
 * Files auto-expire after the configured TTL (default 2h) — so shareable
 * URLs are ephemeral. Extend FILE_TTL_MS env var or move storage to a
 * disk/S3 for longer-lived sharing.
 */
router.get('/:jobId', async (req, res, next) => {
  const { jobId } = req.params;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(jobId)) {
    return res.status(400).send('Invalid flipbook id.');
  }
  const jobDir = path.join(config.outputDir, jobId);
  if (!fs.existsSync(path.join(jobDir, 'manifest.json'))) {
    return res
      .status(404)
      .send(expiredPage());
  }
  try {
    const manifest = await readManifest(jobDir);
    // Inject absolute URLs so the template loads images directly from /output.
    const pages = manifest.pages.map((p) => ({
      ...p,
      src: `/output/${jobId}/${p.file}`,
    }));
    const html = await renderStandaloneHtml(TEMPLATE_PATH, {
      title: manifest.title || 'Flipbook',
      pages,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5-minute edge cache
    res.send(html);
  } catch (err) {
    logger.error(`/view render failed for ${jobId}:`, err);
    next(err);
  }
});

function expiredPage() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Flipbook expired</title>
    <style>
      body { margin:0; min-height:100vh; display:grid; place-items:center;
        font-family: system-ui, sans-serif; background:#0e0c0a; color:#efe7d7;
        text-align:center; padding:32px; }
      .card { max-width: 440px; }
      h1 { font-weight: 500; letter-spacing: -0.02em; }
      p { color:#a89f8e; line-height:1.6; }
      a { color:#d9a441; text-decoration:none; border-bottom:1px dashed; }
    </style></head>
    <body><div class="card">
      <h1>This flipbook has expired</h1>
      <p>Flipbooks are auto-deleted after a few hours to keep the free service fast.
      Ask the sender to regenerate it, or create your own at
      <a href="/">Flipbook Converter</a>.</p>
    </div></body></html>`;
}

module.exports = router;
