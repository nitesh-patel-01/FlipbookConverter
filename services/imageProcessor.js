'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const pLimit = require('p-limit');

const config = require('../config');

sharp.cache(false); // avoid holding large buffers in memory
sharp.concurrency(1);

/**
 * Optimise and resize a single image to JPEG.
 */
async function optimizeOne(srcPath, destPath, { maxWidth, quality }) {
  const pipeline = sharp(srcPath, { failOnError: false })
    .rotate() // auto-orient using EXIF
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, progressive: true });

  await pipeline.toFile(destPath);
  return destPath;
}

/**
 * Optimise a batch of images in parallel (bounded concurrency).
 *
 * @param {object} args
 * @param {Array<{index: number, path: string}>} args.pages
 * @param {string} args.outDir
 * @param {(progress: {stage: string, current: number, total: number}) => void} [args.onProgress]
 * @returns {Promise<Array<{index: number, file: string, thumb: string, width: number, height: number}>>}
 */
async function optimizePages({ pages, outDir, onProgress }) {
  await fs.promises.mkdir(outDir, { recursive: true });

  const limit = pLimit(2);
  let done = 0;
  const total = pages.length;
  onProgress?.({ stage: 'optimizing', current: 0, total });

  const results = await Promise.all(
    pages.map((p) =>
      limit(async () => {
        const padded = String(p.index).padStart(4, '0');
        const outFile = path.join(outDir, `page-${padded}.jpg`);
        const thumbFile = path.join(outDir, `thumb-${padded}.jpg`);

        await optimizeOne(p.path, outFile, {
          maxWidth: config.image.maxWidth,
          quality: config.image.quality,
        });
        await optimizeOne(p.path, thumbFile, {
          maxWidth: config.image.thumbWidth,
          quality: 70,
        });

        const meta = await sharp(outFile).metadata();

        // Remove the raw pdf2pic output to save disk
        fs.promises.unlink(p.path).catch(() => {});

        done += 1;
        onProgress?.({ stage: 'optimizing', current: done, total });

        return {
          index: p.index,
          file: path.basename(outFile),
          thumb: path.basename(thumbFile),
          width: meta.width || 0,
          height: meta.height || 0,
        };
      })
    )
  );

  return results.sort((a, b) => a.index - b.index);
}

/**
 * Optimise a single uploaded raster image (used when the source wasn't a PDF).
 */
async function optimizeUploadedImage({ srcPath, outDir, index }) {
  await fs.promises.mkdir(outDir, { recursive: true });
  const padded = String(index).padStart(4, '0');
  const outFile = path.join(outDir, `page-${padded}.jpg`);
  const thumbFile = path.join(outDir, `thumb-${padded}.jpg`);

  await optimizeOne(srcPath, outFile, {
    maxWidth: config.image.maxWidth,
    quality: config.image.quality,
  });
  await optimizeOne(srcPath, thumbFile, {
    maxWidth: config.image.thumbWidth,
    quality: 70,
  });
  const meta = await sharp(outFile).metadata();

  return {
    index,
    file: path.basename(outFile),
    thumb: path.basename(thumbFile),
    width: meta.width || 0,
    height: meta.height || 0,
  };
}

module.exports = { optimizePages, optimizeUploadedImage };
