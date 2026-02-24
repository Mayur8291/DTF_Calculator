/**
 * DTF Cost Calculator
 * Background removal flow: Upload → SAM segmentation → Refine mask → Alpha matte smoothing → Export
 * Cost: (H+1) × (W+1) × 0.8
 */

const DPI_ASSUMPTION = 150; // Used to convert pixel dimensions to inches for default size
const COST_MULTIPLIER = 0.8;
const CURRENCY = '₹'; // Indian Rupee

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const artworkList = document.getElementById('artworkList');
const totalCostEl = document.getElementById('totalCost');

let artworks = [];

function emitTotal() {
  const total = artworks.reduce((sum, a) => sum + (a.cost ?? 0), 0);
  totalCostEl.textContent = CURRENCY + total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function computeCost(heightInches, widthInches) {
  const h = parseFloat(heightInches);
  const w = parseFloat(widthInches);
  if (Number.isNaN(h) || Number.isNaN(w) || h <= 0 || w <= 0) return 0;
  return (h + 1) * (w + 1) * COST_MULTIPLIER;
}

function pixelsToInches(pixels) {
  return (pixels / DPI_ASSUMPTION).toFixed(2);
}

function createArtworkCard(artwork) {
  const card = document.createElement('div');
  card.className = 'artwork-card';
  card.dataset.id = artwork.id;

  const previewWrap = document.createElement('div');
  previewWrap.className = 'preview-wrap';

  const img = document.createElement('img');
  img.src = artwork.previewUrl;
  img.alt = 'Artwork preview';
  img.onload = () => {
    if (!artwork.widthInches && !artwork.heightInches) {
      artwork.widthInches = pixelsToInches(img.naturalWidth);
      artwork.heightInches = pixelsToInches(img.naturalHeight);
      artwork.cost = computeCost(artwork.heightInches, artwork.widthInches);
      const wInput = card.querySelector('.input-w');
      const hInput = card.querySelector('.input-h');
      const costLine = card.querySelector('.cost-line');
      if (wInput) wInput.value = artwork.widthInches;
      if (hInput) hInput.value = artwork.heightInches;
      if (costLine) costLine.textContent = `Cost: ${CURRENCY}${Number(artwork.cost).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      emitTotal();
    }
  };
  previewWrap.appendChild(img);

  const info = document.createElement('div');
  info.className = 'info';

  const dimensions = document.createElement('div');
  dimensions.className = 'dimensions';
  dimensions.innerHTML = `
    <label>W <input type="number" class="input-w" step="0.01" min="0.1" placeholder="inches" value="${artwork.widthInches || ''}"></label>
    <label>H <input type="number" class="input-h" step="0.01" min="0.1" placeholder="inches" value="${artwork.heightInches || ''}"></label>
  `;

  const costLine = document.createElement('div');
  costLine.className = 'cost-line';
  costLine.textContent = artwork.cost != null ? `Cost: ${CURRENCY}${Number(artwork.cost).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `Cost: ${CURRENCY}0.00`;

  const updateCost = () => {
    const w = card.querySelector('.input-w').value;
    const h = card.querySelector('.input-h').value;
    artwork.widthInches = w;
    artwork.heightInches = h;
    artwork.cost = computeCost(h, w);
    costLine.textContent = `Cost: ${CURRENCY}${Number(artwork.cost).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    emitTotal();
  };

  dimensions.querySelector('.input-w').addEventListener('input', updateCost);
  dimensions.querySelector('.input-h').addEventListener('input', updateCost);

  info.appendChild(dimensions);
  info.appendChild(costLine);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const removeBgBtn = document.createElement('button');
  removeBgBtn.type = 'button';
  removeBgBtn.className = 'btn btn-primary';
  removeBgBtn.textContent = 'Remove background';
  const statusEl = document.createElement('div');
  statusEl.className = 'bg-removal-status';
  statusEl.setAttribute('aria-live', 'polite');
  removeBgBtn.addEventListener('click', () => removeBackground(artwork, previewWrap, img, removeBgBtn, card, statusEl));

  const downloadPngBtn = document.createElement('button');
  downloadPngBtn.type = 'button';
  downloadPngBtn.className = 'btn btn-ghost btn-download-png';
  downloadPngBtn.textContent = 'Download PNG';
  downloadPngBtn.style.display = artwork.backgroundRemoved ? '' : 'none';
  downloadPngBtn.addEventListener('click', () => downloadPng(artwork));

  const removeCardBtn = document.createElement('button');
  removeCardBtn.type = 'button';
  removeCardBtn.className = 'btn btn-danger';
  removeCardBtn.textContent = 'Remove artwork';
  removeCardBtn.addEventListener('click', () => {
    const idx = artworks.findIndex(a => a.id === artwork.id);
    if (idx !== -1) {
      artworks.splice(idx, 1);
      card.remove();
      emitTotal();
    }
  });

  actions.appendChild(removeBgBtn);
  actions.appendChild(statusEl);
  actions.appendChild(downloadPngBtn);
  actions.appendChild(removeCardBtn);

  card.appendChild(previewWrap);
  card.appendChild(info);
  card.appendChild(actions);

  return card;
}

function downloadPng(artwork) {
  if (!artwork.backgroundRemoved || !artwork.previewUrl) return;
  const base = (artwork.file && artwork.file.name) ? artwork.file.name.replace(/\.[^.]+$/, '') : 'image';
  const filename = base + '_nobg.png';
  const a = document.createElement('a');
  a.href = artwork.previewUrl;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function setStatus(el, text, active = true) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('active', active);
}

/** Refine mask: small morphological close on alpha to fill holes and smooth edges */
function refineMask(imageData, w, h) {
  const d = imageData.data;
  const out = new Uint8ClampedArray(d.length);
  out.set(d);
  const radius = 1;
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      let maxA = 0;
      let minA = 255;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const i = ((y + dy) * w + (x + dx)) * 4 + 3;
          maxA = Math.max(maxA, d[i]);
          minA = Math.min(minA, d[i]);
        }
      }
      const i = (y * w + x) * 4 + 3;
      const a = d[i];
      if (a < 128) out[i] = Math.min(a, minA + 40);
      else out[i] = Math.max(a, maxA - 40);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = out[i];
}

/** Alpha matte smoothing: box blur on alpha channel for soft edges */
function alphaMatteSmoothing(imageData, w, h, radius = 2) {
  const d = imageData.data;
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = d[i * 4 + 3];
  const out = new Float32Array(w * h);
  const size = (2 * radius + 1) ** 2;
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      let sum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          sum += alpha[(y + dy) * w + (x + dx)];
        }
      }
      out[y * w + x] = sum / size;
    }
  }
  for (let i = 0; i < w * h; i++) d[i * 4 + 3] = Math.round(out[i]);
}

async function removeBackground(artwork, previewWrap, imgEl, btn, card, statusEl) {
  btn.disabled = true;
  if (statusEl) setStatus(statusEl, '');
  previewWrap.classList.add('loading');
  try {
    setStatus(statusEl, 'Loading…', true);
    const { removeBackground: imglyRemoveBackground } = await import('@imgly/background-removal');

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = artwork.previewUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    const w = img.naturalWidth;
    const h = img.naturalHeight;

    // Pass Blob (file) so the library doesn't fetch a URL; avoids CORS/blob URL issues
    const imageInput = artwork.file || (await (async () => {
      const resp = await fetch(artwork.previewUrl);
      return await resp.blob();
    })());

    const config = {
      output: { format: 'image/png', type: 'foreground' },
      progress: (key, current, total) => {
        if (key.startsWith('fetch') && total > 0 && statusEl)
          setStatus(statusEl, `Downloading model… ${Math.round((current / total) * 100)}%`, true);
      },
    };

    // Step 2: SAM segmentation (neural net segmentation)
    setStatus(statusEl, 'SAM segmentation…', true);
    const blob = await imglyRemoveBackground(imageInput, config);

    const segUrl = URL.createObjectURL(blob);
    const segImg = new Image();
    segImg.crossOrigin = 'anonymous';
    segImg.src = segUrl;
    await new Promise((resolve, reject) => {
      segImg.onload = resolve;
      segImg.onerror = reject;
    });

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(segImg, 0, 0, w, h);
    URL.revokeObjectURL(segUrl);

    let imageData = ctx.getImageData(0, 0, w, h);

    // Step 3: Refine mask
    setStatus(statusEl, 'Refine mask…', true);
    refineMask(imageData, w, h);
    ctx.putImageData(imageData, 0, 0);

    // Step 4: Alpha matte smoothing
    setStatus(statusEl, 'Alpha matte smoothing…', true);
    imageData = ctx.getImageData(0, 0, w, h);
    alphaMatteSmoothing(imageData, w, h, 2);
    ctx.putImageData(imageData, 0, 0);

    setStatus(statusEl, 'Export ready', false);
    const url = canvas.toDataURL('image/png');
    if (artwork.originalPreviewUrl) URL.revokeObjectURL(artwork.previewUrl);
    artwork.originalPreviewUrl = artwork.originalPreviewUrl || artwork.previewUrl;
    artwork.previewUrl = url;
    artwork.backgroundRemoved = true;
    imgEl.src = url;
    if (card) {
      card.classList.add('background-removed');
      const downloadBtn = card.querySelector('.btn-download-png');
      if (downloadBtn) downloadBtn.style.display = '';
    }
  } catch (e) {
    setStatus(statusEl, '', false);
    const msg = e?.message || String(e);
    const hint = msg.includes('fetch') || msg.includes('Failed to fetch')
      ? ' First run downloads the model (~40MB). Use npm run dev and check your network.'
      : '';
    console.error('Background removal error:', e);
    alert('Background removal failed: ' + msg + hint);
  } finally {
    previewWrap.classList.remove('loading');
    btn.disabled = false;
  }
}

function addArtwork(file) {
  const id = 'a' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const previewUrl = URL.createObjectURL(file);
  const artwork = {
    id,
    file,
    previewUrl,
    widthInches: null,
    heightInches: null,
    cost: 0,
    backgroundRemoved: false,
  };
  artworks.push(artwork);
  const card = createArtworkCard(artwork);
  artworkList.appendChild(card);
  emitTotal();
}

function handleFiles(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  imageFiles.forEach(addArtwork);
}

// No click handler needed: the file input is inside the label, so clicking the zone already opens the picker once
fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = '';
});

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});
