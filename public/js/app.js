/* =====================================================================
   Flipbook Converter — front-end app
   Vanilla JS for upload, progress polling, and turn.js preview.
   ===================================================================== */
(function () {
  'use strict';

  // ---------------------------------------------------------------- DOM
  const $ = (sel) => document.querySelector(sel);

  const dropzone = $('#dropzone');
  const fileInput = $('#file-input');
  const filePreview = $('#file-preview');
  const fileName = $('#file-name');
  const fileInfo = $('#file-info');
  const fileClear = $('#file-clear');
  const titleInput = $('#title-input');
  const submitBtn = $('#submit-btn');
  const progressBox = $('#progress-box');
  const progressStage = $('#progress-stage');
  const progressPct = $('#progress-pct');
  const progressFill = $('#progress-fill');
  const progressDetail = $('#progress-detail');
  const errorBox = $('#error-box');

  const fbSection = $('#flipbook-section');
  const fbEl = $('#flipbook');
  const fbIndicator = $('#fb-indicator');
  const fbPrev = $('#fb-prev');
  const fbNext = $('#fb-next');
  const downloadBtn = $('#download-btn');
  const restartBtn = $('#restart-btn');

  // --------------------------------------------------------------- State
  const state = {
    files: [],
    uploading: false,
    jobId: null,
    poll: null,
    turnInstance: null,
  };

  // -------------------------------------------------------------- Const
  const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
  const MAX_SIZE = 50 * 1024 * 1024; // 50 MB per file
  const MAX_IMAGES = 20;

  // -------------------------------------------------------- Dropzone UI
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('is-dragging');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragging');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const list = Array.from(e.dataTransfer?.files || []);
    if (list.length) setFiles(list);
  });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', (e) => {
    const list = Array.from(e.target.files || []);
    if (list.length) setFiles(list);
  });

  fileClear.addEventListener('click', resetForm);
  submitBtn.addEventListener('click', startUpload);
  restartBtn.addEventListener('click', fullReset);

  fbPrev.addEventListener('click', () => state.turnInstance && $('#flipbook').turn('previous'));
  fbNext.addEventListener('click', () => state.turnInstance && $('#flipbook').turn('next'));
  document.addEventListener('keydown', (e) => {
    if (!state.turnInstance) return;
    if (e.key === 'ArrowLeft') $('#flipbook').turn('previous');
    if (e.key === 'ArrowRight') $('#flipbook').turn('next');
  });

  // --------------------------------------------------------- Validation
  function validateFiles(list) {
    if (!list.length) return 'Please select at least one file.';

    const pdfs = list.filter((f) => f.type === 'application/pdf');
    const images = list.filter((f) => f.type.startsWith('image/'));

    if (pdfs.length > 1) return 'Please upload only one PDF at a time.';
    if (pdfs.length === 1 && images.length > 0)
      return 'Upload either one PDF or multiple images — not both.';
    if (images.length > MAX_IMAGES)
      return `You can upload up to ${MAX_IMAGES} images at once.`;

    for (const f of list) {
      if (!ALLOWED_MIME.includes(f.type)) {
        return `Unsupported file type: ${f.name}. Only PDF, JPG, PNG allowed.`;
      }
      if (f.size > MAX_SIZE) {
        return `"${f.name}" is larger than ${MAX_SIZE / 1024 / 1024} MB.`;
      }
      if (f.size === 0) {
        return `"${f.name}" appears to be empty.`;
      }
    }
    return null;
  }

  // ------------------------------------------------------------- Setters
  function setFiles(list) {
    hideError();
    const err = validateFiles(list);
    if (err) return showError(err);

    state.files = list;
    const first = list[0];
    const isPdf = first.type === 'application/pdf';
    fileName.textContent = isPdf
      ? first.name
      : `${list.length} image${list.length > 1 ? 's' : ''}`;
    fileInfo.textContent = isPdf
      ? humanSize(first.size)
      : `${humanSize(list.reduce((a, b) => a + b.size, 0))} total`;
    filePreview.hidden = false;
    dropzone.hidden = true;

    if (!titleInput.value) {
      const base = isPdf
        ? first.name.replace(/\.pdf$/i, '')
        : 'My Flipbook';
      titleInput.value = base.replace(/[_-]+/g, ' ').slice(0, 120);
    }
  }

  function resetForm() {
    state.files = [];
    fileInput.value = '';
    filePreview.hidden = true;
    dropzone.hidden = false;
    hideError();
  }

  function fullReset() {
    stopPolling();
    if (state.turnInstance) {
      try { $('#flipbook').turn('destroy').remove(); } catch (_) { /* noop */ }
      fbEl.innerHTML = '';
      fbEl.id = 'flipbook';
      // Re-insert an empty flipbook div so future mounts work
      const stage = fbSection.querySelector('.flipbook-stage');
      const placeholder = document.createElement('div');
      placeholder.id = 'flipbook';
      placeholder.className = 'flipbook';
      stage.insertBefore(placeholder, stage.querySelector('.nav-arrow--right'));
      state.turnInstance = null;
    }
    fbSection.hidden = true;
    progressBox.hidden = true;
    setProgress(0, 'Preparing…', 'Uploading');
    state.jobId = null;
    resetForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --------------------------------------------------------------- Upload
  function startUpload() {
    if (state.uploading) return;
    if (!state.files.length) return showError('Please select a file first.');

    hideError();
    state.uploading = true;
    submitBtn.disabled = true;
    progressBox.hidden = false;
    setProgress(2, 'Starting upload…', 'Uploading');

    const fd = new FormData();
    const isPdf = state.files.length === 1 && state.files[0].type === 'application/pdf';
    if (isPdf) fd.append('file', state.files[0]);
    else state.files.forEach((f) => fd.append('files', f));
    if (titleInput.value.trim()) fd.append('title', titleInput.value.trim());

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.max(2, Math.min(45, (e.loaded / e.total) * 45));
      setProgress(pct, `${humanSize(e.loaded)} / ${humanSize(e.total)}`, 'Uploading');
    });

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          state.jobId = data.jobId;
          setProgress(48, 'Starting server processing…', 'Processing');
          startPolling();
        } catch (err) {
          failUpload('Invalid server response.');
        }
      } else {
        let msg = 'Upload failed.';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch (_) { /* noop */ }
        failUpload(msg);
      }
    };
    xhr.onerror = () => failUpload('Network error during upload.');
    xhr.send(fd);
  }

  function failUpload(msg) {
    state.uploading = false;
    submitBtn.disabled = false;
    progressBox.hidden = true;
    showError(msg);
  }

  // ---------------------------------------------------- Processing poll
  function startPolling() {
    stopPolling();
    state.poll = setInterval(async () => {
      if (!state.jobId) return;
      try {
        const r = await fetch(`/api/upload/status/${state.jobId}`);
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const job = await r.json();
        handleJobUpdate(job);
      } catch (err) {
        console.error('Poll failed:', err);
      }
    }, 1200);
  }

  function stopPolling() {
    if (state.poll) clearInterval(state.poll);
    state.poll = null;
  }

  function handleJobUpdate(job) {
    if (job.status === 'processing' || job.status === 'queued') {
      const { stage, current, total } = job.progress || {};
      const label = stage === 'converting' ? 'Rendering pages' :
                    stage === 'optimizing'  ? 'Optimising images' :
                    'Processing';
      const pct = total > 0
        ? 50 + Math.floor((current / total) * 45) // 50–95%
        : 50;
      setProgress(pct, `${label} · ${current || 0} / ${total || '?'}`, label);
      return;
    }
    if (job.status === 'error') {
      stopPolling();
      failUpload(job.error || 'Processing failed. Try again.');
      return;
    }
    if (job.status === 'done') {
      stopPolling();
      setProgress(100, `Ready · ${job.pages?.length || 0} pages`, 'Done');
      setTimeout(() => launchFlipbook(state.jobId), 350);
    }
  }

  // --------------------------------------------------------- Flipbook UI
  async function launchFlipbook(jobId) {
    try {
      const r = await fetch(`/api/flipbook/${jobId}`);
      if (!r.ok) throw new Error('Failed to load flipbook');
      const manifest = await r.json();
      renderFlipbook(manifest);
      downloadBtn.href = `/api/download/${jobId}?title=${encodeURIComponent(manifest.title || '')}`;
      downloadBtn.setAttribute('download', `flipbook-${jobId}.zip`);
      fbSection.hidden = false;
      progressBox.hidden = true;
      state.uploading = false;
      submitBtn.disabled = false;
      // Smooth scroll after layout settles
      setTimeout(() => fbSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (err) {
      failUpload(err.message);
    }
  }

  function renderFlipbook(manifest) {
    // Ensure a clean turn.js container
    if (state.turnInstance) {
      try { $('#flipbook').turn('destroy').remove(); } catch (_) { /* noop */ }
      const stage = fbSection.querySelector('.flipbook-stage');
      const placeholder = document.createElement('div');
      placeholder.id = 'flipbook';
      placeholder.className = 'flipbook';
      stage.insertBefore(placeholder, stage.querySelector('.nav-arrow--right'));
    }

    const $fb = window.$('#flipbook').empty();

    // Cover spacer so page 1 appears on the right
    $fb.append('<div class="page"><div class="placeholder">Cover</div></div>');
    manifest.pages.forEach((p) => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = `Page ${p.index}`;
      img.src = p.url;
      const pg = document.createElement('div');
      pg.className = 'page';
      pg.appendChild(img);
      $fb.append(pg);
    });
    if (manifest.pages.length % 2 === 1) {
      $fb.append('<div class="page"><div class="placeholder">End</div></div>');
    }

    const size = computeBookSize();
    window.$('#flipbook').turn({
      width: size.w,
      height: size.h,
      autoCenter: true,
      gradients: true,
      acceleration: true,
      elevation: 50,
      duration: 900,
      when: {
        turned: function (_e, page) {
          fbIndicator.textContent =
            page + ' / ' + window.$('#flipbook').turn('pages');
        },
      },
    });
    state.turnInstance = true;
    fbIndicator.textContent = '1 / ' + window.$('#flipbook').turn('pages');

    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        if (!state.turnInstance) return;
        const s = computeBookSize();
        try { window.$('#flipbook').turn('size', s.w, s.h); } catch (_) {}
      }, 120);
    }, { passive: true });
  }

  function computeBookSize() {
    const stage = fbSection.querySelector('.flipbook-stage');
    const rect = stage.getBoundingClientRect();
    const maxW = Math.min(rect.width - 80, 1120);
    const maxH = Math.min(window.innerHeight - 260, 780);
    const ratio = 1.414; // A4
    let pageW = Math.min(560, Math.floor(maxW / 2));
    let pageH = Math.floor(pageW * ratio);
    if (pageH > maxH) {
      pageH = maxH;
      pageW = Math.floor(pageH / ratio);
    }
    return { w: Math.max(320, pageW * 2), h: Math.max(400, pageH) };
  }

  // --------------------------------------------------------------- Utils
  function setProgress(pct, detail, stage) {
    const clamped = Math.max(0, Math.min(100, pct));
    progressFill.style.width = clamped + '%';
    progressPct.textContent = Math.round(clamped) + '%';
    progressDetail.textContent = detail || '';
    progressStage.textContent = stage || '';
    progressBox.querySelector('.progress-bar').setAttribute('aria-valuenow', Math.round(clamped));
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function hideError() {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  function humanSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i += 1;
    }
    return `${bytes.toFixed(bytes < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }
})();
