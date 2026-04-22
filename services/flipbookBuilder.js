'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const logger = require('../utils/logger');

/**
 * Persist job metadata inside the output folder.
 */
async function writeManifest(jobDir, manifest) {
  const file = path.join(jobDir, 'manifest.json');
  await fs.promises.writeFile(file, JSON.stringify(manifest, null, 2), 'utf8');
  return file;
}

async function readManifest(jobDir) {
  const file = path.join(jobDir, 'manifest.json');
  const raw = await fs.promises.readFile(file, 'utf8');
  return JSON.parse(raw);
}

/**
 * Render the standalone flipbook HTML by injecting the page list into the
 * template file. Keeps the template file as the single source of truth.
 */
async function renderStandaloneHtml(templatePath, { title, pages }) {
  const tpl = await fs.promises.readFile(templatePath, 'utf8');
  const payload = JSON.stringify({ title, pages });
  return tpl
    .replace(/__FLIPBOOK_TITLE__/g, escapeHtml(title))
    .replace('"__FLIPBOOK_DATA__"', payload);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Stream a ZIP of a completed job (HTML + pages + thumbs + manifest).
 * Returns a promise that resolves when the archive has finished piping
 * into the given writable stream.
 */
function streamJobAsZip({ jobDir, jobId, res, templatePath, title }) {
  return new Promise(async (resolve, reject) => {
    try {
      const manifest = await readManifest(jobDir);
      const html = await renderStandaloneHtml(templatePath, {
        title: title || manifest.title || 'My Flipbook',
        pages: manifest.pages,
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="flipbook-${jobId}.zip"`
      );

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('warning', (err) => logger.warn('archiver warn:', err));
      archive.on('error', (err) => {
        logger.error('archiver error:', err);
        reject(err);
      });
      archive.on('end', () => resolve());

      archive.pipe(res);

      // 1) Flipbook HTML at root
      archive.append(html, { name: 'flipbook.html' });

      // 2) Manifest
      archive.append(JSON.stringify(manifest, null, 2), {
        name: 'manifest.json',
      });

      // 3) Readme
      archive.append(buildReadme(manifest), { name: 'README.txt' });

      // 4) Page images + thumbs
      for (const page of manifest.pages) {
        const pageFile = path.join(jobDir, page.file);
        const thumbFile = path.join(jobDir, page.thumb);
        if (fs.existsSync(pageFile)) {
          archive.file(pageFile, { name: `pages/${page.file}` });
        }
        if (fs.existsSync(thumbFile)) {
          archive.file(thumbFile, { name: `pages/${page.thumb}` });
        }
      }

      archive.finalize();
    } catch (err) {
      reject(err);
    }
  });
}

function buildReadme(manifest) {
  return [
    `FLIPBOOK — ${manifest.title || 'Untitled'}`,
    `Generated: ${manifest.createdAt}`,
    `Pages: ${manifest.pages.length}`,
    '',
    'HOW TO USE',
    '----------',
    '1) Keep flipbook.html in the same folder as the /pages directory.',
    '2) Double-click flipbook.html to open in any modern browser.',
    '3) To host online, upload the entire folder to any static host',
    '   (Netlify, Vercel, GitHub Pages, Render Static Site, S3, etc.).',
    '',
    'Powered by turn.js · Single-file portable flipbook bundle.',
    '',
  ].join('\n');
}

module.exports = {
  writeManifest,
  readManifest,
  renderStandaloneHtml,
  streamJobAsZip,
};
