# --------------------------------------------------------------------
# Flipbook Converter — production Dockerfile
# Ships with poppler (pdfinfo) + graphicsmagick + ghostscript so that
# pdf2pic works reliably on Render Web Service.
# --------------------------------------------------------------------
FROM node:20-bookworm-slim AS base

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    PORT=3000

# System dependencies for pdf2pic (GraphicsMagick + Ghostscript + poppler)
# + tini for clean signal handling
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      graphicsmagick \
      ghostscript \
      poppler-utils \
      fonts-dejavu-core \
      tini \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# Copy application source
COPY . .

# Ensure writable storage paths
RUN mkdir -p /app/storage/uploads /app/storage/output \
 && chown -R node:node /app

USER node

EXPOSE 3000

# tini as PID 1 for proper SIGTERM forwarding
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
