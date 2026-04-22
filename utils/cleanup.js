'use strict';

const fs = require('fs');
const path = require('path');

const config = require('../config');
const logger = require('./logger');

/**
 * Recursively delete a directory (node 14+ safe).
 */
async function rmrf(target) {
  await fs.promises.rm(target, { recursive: true, force: true });
}

/**
 * Remove files/folders older than `config.fileTtlMs` inside a root directory.
 */
async function cleanDirectory(rootDir) {
  if (!fs.existsSync(rootDir)) return 0;
  let removed = 0;
  const now = Date.now();
  const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    try {
      const stat = await fs.promises.stat(full);
      const age = now - stat.mtimeMs;
      if (age > config.fileTtlMs) {
        await rmrf(full);
        removed += 1;
      }
    } catch (err) {
      logger.warn(`Cleanup skip ${full}: ${err.message}`);
    }
  }
  return removed;
}

async function runCleanup() {
  try {
    const [u, o] = await Promise.all([
      cleanDirectory(config.uploadDir),
      cleanDirectory(config.outputDir),
    ]);
    if (u || o) logger.info(`Cleanup removed ${u} upload(s), ${o} output(s).`);
  } catch (err) {
    logger.error('Cleanup job failed:', err);
  }
}

function startCleanupJob() {
  // Ensure directories exist at boot
  for (const dir of [config.uploadDir, config.outputDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Run once at boot then on interval
  runCleanup();
  const timer = setInterval(runCleanup, config.cleanupIntervalMs);
  timer.unref();
  logger.info(
    `Cleanup job scheduled every ${Math.round(
      config.cleanupIntervalMs / 60000
    )}m (TTL ${Math.round(config.fileTtlMs / 60000)}m).`
  );
}

// CLI mode: `node utils/cleanup.js --run`
if (require.main === module && process.argv.includes('--run')) {
  runCleanup().then(() => process.exit(0));
}

module.exports = { startCleanupJob, runCleanup, rmrf };
