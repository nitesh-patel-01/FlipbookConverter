'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const archiver = require('archiver');

const logger = require('../utils/logger');

/* -------------------------------------------------------------------- */
/*  Manifest I/O                                                         */
/* -------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------- */
/*  Template rendering                                                   */
/*                                                                       */
/*  The template uses "__FLIPBOOK_DATA__" as a JSON payload placeholder. */
/*  Each page object may optionally carry `src` (absolute URL or data    */
/*  URI). If `src` is absent, the client builds `pages/<file>` relative. */
/* -------------------------------------------------------------------- */
async function renderStandaloneHtml(templatePath, { title, pages, inlineScripts }) {
  let tpl = await fs.promises.readFile(templatePath, 'utf8');
  const payload = JSON.stringify({ title, pages });

  tpl = tpl
    .replace(/__FLIPBOOK_TITLE__/g, escapeHtml(title))
    .replace('"__FLIPBOOK_DATA__"', payload);

  if (inlineScripts) {
    const { jquery, turnjs } = await getVendorScripts();
    tpl = tpl.replace(
      /<script src="https:\/\/code\.jquery\.com\/[^"]+"[^>]*><\/script>/,
      `<script>/* jQuery inlined */\n${jquery}\n</script>`
    );
    tpl = tpl.replace(
      /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/turn\.js\/[^"]+"[^>]*><\/script>/,
      `<script>/* turn.js inlined */\n${turnjs}\n</script>`
    );
  }

  return tpl;
}

/**
 * Generate a fully self-contained single-file HTML flipbook —
 *   - every page image embedded as a base64 data URI
 *   - jQuery + turn.js inlined so it works with or without internet
 * Perfect for sharing one standalone .html attachment over WhatsApp/email.
 */
async function renderSingleFileHtml(templatePath, { title, jobDir, manifest }) {
  const pages = await Promise.all(
    manifest.pages.map(async (p) => {
      const imgPath = path.join(jobDir, p.file);
      const buffer = await fs.promises.readFile(imgPath);
      const src = `data:image/jpeg;base64,${buffer.toString('base64')}`;
      return { index: p.index, src, width: p.width, height: p.height };
    })
  );

  return renderStandaloneHtml(templatePath, {
    title,
    pages,
    inlineScripts: true,
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------- */
/*  Vendor script cache (jQuery + turn.js) — fetched once on first use   */
/* -------------------------------------------------------------------- */
const VENDOR_CACHE = { jquery: null, turnjs: null };

const VENDOR_SOURCES = {
  jquery: 'https://code.jquery.com/jquery-3.7.1.min.js',
  turnjs: 'https://cdnjs.cloudflare.com/ajax/libs/turn.js/3/turn.min.js',
};

async function getVendorScripts() {
  if (VENDOR_CACHE.jquery && VENDOR_CACHE.turnjs) return VENDOR_CACHE;

  const cacheDir = path.join(__dirname, '..', 'templates', 'vendor');
  await fs.promises.mkdir(cacheDir, { recursive: true });

  const loadOne = async (key, url) => {
    const local = path.join(cacheDir, `${key}.min.js`);
    if (fs.existsSync(local)) {
      return fs.promises.readFile(local, 'utf8');
    }
    logger.info(`Vendoring ${key} from ${url}`);
    const body = await httpsGet(url);
    await fs.promises.writeFile(local, body, 'utf8');
    return body;
  };

  VENDOR_CACHE.jquery = await loadOne('jquery', VENDOR_SOURCES.jquery);
  VENDOR_CACHE.turnjs = await loadOne('turnjs', VENDOR_SOURCES.turnjs);
  return VENDOR_CACHE;
}

function httpsGet(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          return httpsGet(res.headers.location, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/* -------------------------------------------------------------------- */
/*  ZIP streaming                                                        */
/* -------------------------------------------------------------------- */
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

      archive.append(html, { name: 'flipbook.html' });
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
      archive.append(buildReadme(manifest), { name: 'README.txt' });

      for (const page of manifest.pages) {
        const pageFile = path.join(jobDir, page.file);
        const thumbFile = path.join(jobDir, page.thumb);
        if (fs.existsSync(pageFile)) archive.file(pageFile, { name: `pages/${page.file}` });
        if (fs.existsSync(thumbFile)) archive.file(thumbFile, { name: `pages/${page.thumb}` });
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
    'Powered by turn.js · Portable flipbook bundle.',
    '',
  ].join('\n');
}

module.exports = {
  writeManifest,
  readManifest,
  renderStandaloneHtml,
  renderSingleFileHtml,
  streamJobAsZip,
  getVendorScripts,
};
