'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const { startCleanupJob } = require('./utils/cleanup');
const errorHandler = require('./middleware/errorHandler');

const uploadRoute = require('./routes/upload');
const flipbookRoute = require('./routes/flipbook');
const downloadRoute = require('./routes/download');
const viewRoute = require('./routes/view');

const app = express();

/* ------------------------------------------------------------------ */
/*  Trust proxy (Render sits behind a load balancer)                  */
/* ------------------------------------------------------------------ */
app.set('trust proxy', 1);

/* ------------------------------------------------------------------ */
/*  Security & performance middleware                                 */
/* ------------------------------------------------------------------ */
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://code.jquery.com',
          'https://cdnjs.cloudflare.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(cors({ origin: config.corsOrigin }));
app.use(morgan(config.isProd ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* ------------------------------------------------------------------ */
/*  Global rate limit (DDoS protection)                               */
/* ------------------------------------------------------------------ */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later.' },
});
app.use(globalLimiter);

/* ------------------------------------------------------------------ */
/*  Static assets                                                     */
/* ------------------------------------------------------------------ */
app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: config.isProd ? '7d' : 0,
    etag: true,
    lastModified: true,
  })
);

// Serve generated flipbook pages (images) read-only, with caching
app.use(
  '/output',
  express.static(config.outputDir, {
    maxAge: '1d',
    immutable: false,
    fallthrough: true,
  })
);

/* ------------------------------------------------------------------ */
/*  API routes                                                        */
/* ------------------------------------------------------------------ */
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', uptime: process.uptime(), ts: Date.now() })
);

app.use('/api/upload', uploadRoute);
app.use('/api/flipbook', flipbookRoute);
app.use('/api/download', downloadRoute);

// Public hosted-flipbook viewer (shareable URLs like /view/abc123)
app.use('/view', viewRoute);

/* ------------------------------------------------------------------ */
/*  SEO + root                                                        */
/* ------------------------------------------------------------------ */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// SPA-style 404 for any unknown non-API route => serve index
app.use((req, res, next) => {
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/output/') ||
    req.path.startsWith('/view/')
  ) {
    return next();
  }
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ------------------------------------------------------------------ */
/*  Error handler (last)                                              */
/* ------------------------------------------------------------------ */
app.use(errorHandler);

/* ------------------------------------------------------------------ */
/*  Boot                                                              */
/* ------------------------------------------------------------------ */
const server = app.listen(config.port, () => {
  logger.info(`Flipbook Converter listening on :${config.port} (${config.env})`);
  startCleanupJob();
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.warn(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
  // Force kill after 10s
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

module.exports = app;
