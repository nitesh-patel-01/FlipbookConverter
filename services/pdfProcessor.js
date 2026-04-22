'use strict';

const fs = require('fs');
const path = require('path');
const { fromPath } = require('pdf2pic');
const pLimit = require('p-limit');

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Count pages in a PDF without rendering them. Uses pdf2pic's underlying
 * `bulk(-1)` signal by asking for metadata via the tool's own API.
 *
 * We piggy-back on pdf2pic's `setGMClass()` fallback by reading with a
 * minimal render invocation targeting a single page and inspecting errors.
 * For robustness in production, we shell out to `pdfinfo` if available, else
 * we rely on rendering and stopping when pages run out.
 */
async function getPageCount(pdfPath) {
  // Prefer a lightweight parse via pdf2pic — it throws a descriptive error
  // if we ask for an invalid page, but doesn't directly expose count. We
  // therefore render page 1 to get a success signal and use binary search
  // for the real count when `pdfinfo` is unavailable.
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const exec = promisify(execFile);
    const { stdout } = await exec('pdfinfo', [pdfPath]);
    const match = stdout.match(/Pages:\s+(\d+)/i);
    if (match) return parseInt(match[1], 10);
  } catch {
    // pdfinfo not present — fall through to probe approach
  }
  // Fallback: probe pages by rendering (slow but reliable for small books).
  return probePageCount(pdfPath);
}

async function probePageCount(pdfPath) {
  const converter = fromPath(pdfPath, {
    density: 72,
    format: 'jpeg',
    width: 100,
    height: 140,
    savePath: path.dirname(pdfPath),
    saveFilename: `probe_${Date.now()}`,
  });
  let lo = 1;
  let hi = config.pdf.maxPages;
  let last = 0;
  // Exponential probe to find an upper bound cheaply
  while (lo <= hi) {
    try {
      await converter(lo, { responseType: 'buffer' });
      last = lo;
      lo *= 2;
    } catch {
      break;
    }
  }
  // Binary-narrow between last-success and first-failure
  let low = last;
  let high = Math.min(last * 2, hi);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    try {
      await converter(mid, { responseType: 'buffer' });
      low = mid;
    } catch {
      high = mid - 1;
    }
  }
  return low;
}

/**
 * Convert a PDF to per-page JPEGs, processed in chunks to avoid blocking.
 *
 * @param {object} args
 * @param {string} args.pdfPath   absolute path to the PDF file
 * @param {string} args.outDir    directory where raw page images will be written
 * @param {(progress: {stage: string, current: number, total: number}) => void} [args.onProgress]
 * @returns {Promise<{pages: Array<{index: number, path: string}>, total: number}>}
 */
async function convertPdfToImages({ pdfPath, outDir, onProgress }) {
  await fs.promises.mkdir(outDir, { recursive: true });

  const totalPages = await getPageCount(pdfPath);
  if (totalPages === 0) throw new Error('PDF has no pages or is corrupt.');
  if (totalPages > config.pdf.maxPages) {
    throw new Error(
      `PDF has ${totalPages} pages, exceeding the ${config.pdf.maxPages}-page limit.`
    );
  }

  onProgress?.({ stage: 'converting', current: 0, total: totalPages });
  logger.info(`PDF ${path.basename(pdfPath)} → ${totalPages} pages`);

  const converter = fromPath(pdfPath, {
    density: config.pdf.density,
    format: config.pdf.format,
    width: config.pdf.width,
    height: config.pdf.height,
    savePath: outDir,
    saveFilename: 'page',
    preserveAspectRatio: true,
  });

  const limit = pLimit(config.pdf.concurrency);
  const pages = new Array(totalPages);
  let done = 0;

  // Process in chunks so we can yield to the event loop between batches
  const chunkSize = config.pdf.chunkSize;
  for (let start = 1; start <= totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, totalPages);
    const tasks = [];
    for (let p = start; p <= end; p += 1) {
      tasks.push(
        limit(async () => {
          const result = await converter(p, { responseType: 'image' });
          pages[p - 1] = { index: p, path: result.path };
          done += 1;
          onProgress?.({ stage: 'converting', current: done, total: totalPages });
        })
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(tasks);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setImmediate(r)); // yield
  }

  return { pages: pages.filter(Boolean), total: totalPages };
}

module.exports = { convertPdfToImages, getPageCount };
