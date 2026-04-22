'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { nanoid } = require('nanoid');

const config = require('../config');
const logger = require('../utils/logger');
const { validateFile } = require('../utils/validator');
const upload = require('../middleware/upload');
const { uploadLimiter } = require('../middleware/rateLimit');
const { convertPdfToImages } = require('../services/pdfProcessor');
const {
  optimizePages,
  optimizeUploadedImage,
} = require('../services/imageProcessor');
const { writeManifest } = require('../services/flipbookBuilder');
const { rmrf } = require('../utils/cleanup');

const router = express.Router();

/**
 * In-memory job tracker. For multi-instance deployments, swap this for
 * Redis. Single-instance Render Web Service is fine with in-process state.
 */
const jobs = new Map(); // jobId -> { status, progress, pages, error, createdAt }

function setJob(id, data) {
  const prev = jobs.get(id) || {};
  jobs.set(id, { ...prev, ...data, updatedAt: Date.now() });
}

function getJob(id) {
  return jobs.get(id);
}

// Periodically prune finished/failed jobs from memory after 1h
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - (job.updatedAt || 0) > 60 * 60 * 1000) jobs.delete(id);
  }
}, 10 * 60 * 1000).unref();

/**
 * POST /api/upload
 * Accepts either:
 *   - a single PDF as field `file`
 *   - OR multiple images as field `files`
 */
router.post(
  '/',
  uploadLimiter,
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 20 },
  ]),
  async (req, res, next) => {
    const jobId = nanoid(12);
    const jobDir = path.join(config.outputDir, jobId);
    let uploadedPaths = [];

    try {
      const fileField = req.files?.file?.[0];
      const filesField = req.files?.files || [];
      const allUploads = [fileField, ...filesField].filter(Boolean);

      if (allUploads.length === 0) {
        return res.status(400).json({ error: 'No file uploaded.' });
      }

      uploadedPaths = allUploads.map((f) => f.path);

      // Magic-byte validate every uploaded file
      for (const up of allUploads) {
        // eslint-disable-next-line no-await-in-loop
        const check = await validateFile(up.path);
        if (!check.ok) {
          await cleanup(uploadedPaths, jobDir);
          return res
            .status(415)
            .json({ error: `Invalid file (${up.originalname}): ${check.reason}` });
        }
      }

      await fs.promises.mkdir(jobDir, { recursive: true });

      const title =
        (req.body?.title && String(req.body.title).slice(0, 120)) ||
        deriveTitle(allUploads[0].originalname);

      setJob(jobId, {
        status: 'queued',
        progress: { stage: 'queued', current: 0, total: 0 },
        title,
        createdAt: new Date().toISOString(),
      });

      // Respond immediately with the job id; client polls /status.
      res.status(202).json({ jobId, title, status: 'queued' });

      // Process asynchronously — never block the response
      processJob({ jobId, jobDir, title, uploads: allUploads }).catch((err) => {
        logger.error(`Job ${jobId} failed:`, err);
        setJob(jobId, {
          status: 'error',
          error: err.message || 'Processing failed',
        });
        cleanup(uploadedPaths, null).catch(() => {});
      });
    } catch (err) {
      await cleanup(uploadedPaths, jobDir);
      next(err);
    }
  }
);

/**
 * GET /api/upload/status/:jobId
 * Returns live progress information so the client can render a bar.
 */
router.get('/status/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ jobId: req.params.jobId, ...job });
});

/* ------------------------------------------------------------------ */
/*  Orchestration                                                     */
/* ------------------------------------------------------------------ */

async function processJob({ jobId, jobDir, title, uploads }) {
  setJob(jobId, { status: 'processing' });

  const onProgress = (p) => setJob(jobId, { progress: p });

  let pages = [];
  const isSinglePdf =
    uploads.length === 1 && uploads[0].mimetype === 'application/pdf';

  if (isSinglePdf) {
    const { pages: raw } = await convertPdfToImages({
      pdfPath: uploads[0].path,
      outDir: jobDir,
      onProgress,
    });
    pages = await optimizePages({ pages: raw, outDir: jobDir, onProgress });
  } else {
    // Treat uploads as a sequence of images → flipbook
    const total = uploads.length;
    onProgress({ stage: 'optimizing', current: 0, total });
    pages = [];
    for (let i = 0; i < uploads.length; i += 1) {
      const u = uploads[i];
      if (u.mimetype === 'application/pdf') {
        throw new Error(
          'Mixing PDFs with images in a single upload is not supported. Upload a single PDF or only images.'
        );
      }
      // eslint-disable-next-line no-await-in-loop
      const page = await optimizeUploadedImage({
        srcPath: u.path,
        outDir: jobDir,
        index: i + 1,
      });
      pages.push(page);
      onProgress({ stage: 'optimizing', current: i + 1, total });
    }
  }

  // Delete originals from uploads/ — we only need optimised copies now
  await Promise.all(uploads.map((u) => fs.promises.unlink(u.path).catch(() => {})));

  const manifest = {
    id: jobId,
    title,
    pages,
    createdAt: new Date().toISOString(),
  };
  await writeManifest(jobDir, manifest);

  setJob(jobId, {
    status: 'done',
    progress: {
      stage: 'done',
      current: pages.length,
      total: pages.length,
    },
    pages,
    manifestPath: path.join(jobDir, 'manifest.json'),
  });

  logger.info(`Job ${jobId} complete — ${pages.length} page(s).`);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function cleanup(paths, jobDir) {
  for (const p of paths) {
    try {
      await fs.promises.unlink(p);
    } catch {
      /* ignore */
    }
  }
  if (jobDir) {
    await rmrf(jobDir).catch(() => {});
  }
}

function deriveTitle(originalName) {
  const base = path.basename(originalName, path.extname(originalName));
  return base.replace(/[-_]+/g, ' ').trim() || 'My Flipbook';
}

module.exports = router;
module.exports.getJob = getJob;
