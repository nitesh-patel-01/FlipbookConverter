# Flipbook Converter

Turn any PDF — or a stack of images — into a beautiful interactive flipbook with realistic page-turn animations. Preview it live in the browser, then download a self-contained HTML ZIP you can host anywhere.

![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Docker](https://img.shields.io/badge/docker-ready-informational)

---

## Features

- Drag-and-drop upload — PDF, JPG, PNG
- PDF → per-page JPEG via `pdf2pic` (GraphicsMagick + Ghostscript)
- Image optimisation with `sharp` (progressive JPEG, mozjpeg)
- Chunked, bounded-concurrency page rendering to avoid blocking the event loop
- Live preview with `turn.js`
- Download as a portable HTML ZIP (`archiver`) — host on any static server
- Progress bar with live server-side progress polling
- Automatic cleanup of old files (configurable TTL)
- Mobile responsive, keyboard-navigable
- Hardened: Helmet + CSP, magic-byte validation, size limits, per-IP rate limiting
- SEO-complete: meta + OG + Twitter tags, JSON-LD, `robots.txt`, `sitemap.xml`
- Docker-ready for Render

---

## Folder structure

```
flipbook-converter/
├── server.js                  # Express entry point
├── package.json
├── Dockerfile                 # Debian + GM + Ghostscript + poppler
├── render.yaml                # Render IaC
├── .env.example
├── .gitignore
├── .dockerignore
├── .nvmrc
├── config/
│   └── index.js               # Central config loaded from env
├── routes/
│   ├── upload.js              # POST /api/upload + /status/:jobId
│   ├── flipbook.js            # GET  /api/flipbook/:jobId (manifest)
│   └── download.js            # GET  /api/download/:jobId (ZIP)
├── services/
│   ├── pdfProcessor.js        # pdf2pic + chunked conversion
│   ├── imageProcessor.js      # sharp optimisation
│   └── flipbookBuilder.js     # manifest + template + ZIP streaming
├── middleware/
│   ├── upload.js              # multer + MIME filter
│   ├── rateLimit.js           # per-endpoint limiters
│   └── errorHandler.js        # centralised error responses
├── utils/
│   ├── logger.js
│   ├── validator.js           # magic-byte + filename sanitiser
│   └── cleanup.js             # TTL-based disk GC
├── templates/
│   └── flipbook.html          # standalone flipbook template (inside ZIP)
├── public/                    # static frontend
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   ├── favicon.svg  favicon.ico  og-image.svg
│   ├── robots.txt  sitemap.xml
└── storage/
    ├── uploads/  (runtime)
    └── output/   (runtime)
```

---

## Run locally

### Option A — Node (fastest)

System requirements (for `pdf2pic`):

- **macOS**: `brew install graphicsmagick ghostscript poppler`
- **Ubuntu / Debian**: `sudo apt-get install -y graphicsmagick ghostscript poppler-utils`
- **Windows**: install [GraphicsMagick](http://www.graphicsmagick.org/download.html) and [Ghostscript](https://www.ghostscript.com/releases/gsdnld.html); add both to `PATH`.

```bash
git clone <your-repo-url> flipbook-converter
cd flipbook-converter
cp .env.example .env
npm install
npm run dev         # hot reload via nodemon
# or: npm start
```

Open <http://localhost:3000>.

### Option B — Docker (no system deps needed)

```bash
docker build -t flipbook-converter .
docker run --rm -p 3000:3000 flipbook-converter
```

---

## Configuration (environment variables)

See `.env.example` for the full list. Highlights:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MAX_UPLOAD_SIZE_MB` | `50` | Per-file upload cap |
| `PDF_MAX_PAGES` | `300` | Reject PDFs larger than this |
| `PDF_DENSITY` | `150` | DPI used when rasterising pages |
| `PDF_CONCURRENCY` | `2` | Parallel page renders |
| `PDF_CHUNK_SIZE` | `5` | Pages rendered per chunk before yielding |
| `IMAGE_QUALITY` | `82` | JPEG quality for optimised pages |
| `IMAGE_MAX_WIDTH` | `1400` | Resize cap for optimised pages |
| `FILE_TTL_MS` | `7200000` (2 h) | Auto-delete age |
| `CLEANUP_INTERVAL_MS` | `1800000` (30 m) | Cleanup cadence |

---

## API reference

### `POST /api/upload`

Form-data fields:

- `file` — a single PDF, **or**
- `files` — up to 20 images (JPG / PNG)
- `title` — optional string (≤ 120 chars)

Returns `202 Accepted`:

```json
{ "jobId": "abc123XYZ...", "title": "My Flipbook", "status": "queued" }
```

### `GET /api/upload/status/:jobId`

Returns live job state:

```json
{
  "status": "processing",
  "progress": { "stage": "converting", "current": 4, "total": 24 }
}
```

Final states: `done` (with `pages: [...]`) or `error`.

### `GET /api/flipbook/:jobId`

Returns the manifest with URLs for every page (`/output/:jobId/page-XXXX.jpg`).

### `GET /api/download/:jobId`

Streams a ZIP containing `flipbook.html`, `manifest.json`, `pages/page-*.jpg`, `pages/thumb-*.jpg`, and a `README.txt`.

### `GET /api/health`

Liveness probe for Render.

---

## Deploy on Render (recommended)

**Render uses the Dockerfile** — this is the simplest path because `pdf2pic` needs system packages.

1. Push this repo to GitHub / GitLab.
2. In Render, click **New → Web Service** and point it at the repo.
3. Render will auto-detect `render.yaml`. Confirm:
   - **Environment**: Docker
   - **Dockerfile path**: `./Dockerfile`
   - **Health check**: `/api/health`
4. (Optional) edit environment variables on the dashboard.
5. Click **Create Web Service**.

After it boots, your app is at `https://<your-service>.onrender.com`.

### Notes on Render

- Render’s filesystem is ephemeral — that is fine because we auto-expire files. If you need persistent storage, mount a Render disk at `/app/storage`.
- The default `starter` plan is enough for casual use. Bump the plan for larger PDFs or higher concurrency.
- Remember to update the canonical URL in `public/index.html`, `public/sitemap.xml`, and `render.yaml`’s `PUBLIC_BASE_URL` after you know your final domain.

---

## Security hardening in place

- `helmet` with a strict CSP (only allows jQuery + turn.js CDNs)
- `express-rate-limit` — global + upload + download
- Magic-byte validation via `file-type` (not just MIME)
- Per-extension allow-list
- Filename sanitiser (`[^a-zA-Z0-9._-]`)
- Size caps enforced by `multer` and re-checked after write
- `compression` + static asset caching
- No user data stored beyond the configured TTL

---

## Roadmap / ideas

- Optional S3 / R2 storage backend
- Shareable read-only preview URLs
- Per-user quota + auth (JWT)
- Support animated GIF/WebP page transitions
- Watermarking
- PWA for offline use

---

## Licence

MIT
