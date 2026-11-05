/**
 * source.js
 * 原稿（PDF・画像）を、直す枠の横に出す。ページ番号で引く。
 * 原稿はこの画面の中だけで開き、どこにも送らない（PDFを開く部品だけ、最初に外から取る）。
 */
(function (root) {
  'use strict';

  const RENDER_WIDTH = 1800;          // 画面に出す原稿の横幅（ピクセル）。拡大しても読めるように大きめ
  const BACKGROUND_BLOCK = 16;        // 紙の地色を調べる区切りの大きさ（ピクセル）
  const LEVEL_LOW_PERCENT = 0.5;      // この割合より暗い所を、真っ黒にそろえる
  const LEVEL_HIGH_PERCENT = 60;      // この割合より明るい所を、真っ白にそろえる
  const GAMMA = 1.8;                  // 薄い線を濃くする強さ
  const CACHE_SIZE = 4;               // 描いたページを覚えておく数
  const ZOOM_STEPS = [100, 150, 200, 300, 400];
  const DEFAULT_ZOOM_INDEX = 2;       // 初めは200%（横に並べた狭い欄でも字が読める大きさ）
  const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  // ---- 濃くする（紙の地色と影をそろえ、薄い線を濃くする） ---------------------

  /** RGBA の画素を、その場でグレーに直して濃くする。 */
  function enhanceImageData(data, width, height) {
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    const bw = Math.ceil(width / BACKGROUND_BLOCK);
    const bh = Math.ceil(height / BACKGROUND_BLOCK);
    let grid = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        let max = 0;
        for (let y = by * BACKGROUND_BLOCK; y < Math.min(height, (by + 1) * BACKGROUND_BLOCK); y++) {
          for (let x = bx * BACKGROUND_BLOCK; x < Math.min(width, (bx + 1) * BACKGROUND_BLOCK); x++) {
            if (gray[y * width + x] > max) max = gray[y * width + x];
          }
        }
        grid[by * bw + bx] = max;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const blurred = new Float32Array(grid.length);
      for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
          let sum = 0;
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const yy = by + dy;
              const xx = bx + dx;
              if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { sum += grid[yy * bw + xx]; count++; }
            }
          }
          blurred[by * bw + bx] = sum / count;
        }
      }
      grid = blurred;
    }
    const normalized = new Float32Array(gray.length);
    const histogram = new Uint32Array(256);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const background = Math.max(grid[Math.floor(y / BACKGROUND_BLOCK) * bw + Math.floor(x / BACKGROUND_BLOCK)], 1);
        const value = Math.min(255, (gray[y * width + x] / background) * 255);
        normalized[y * width + x] = value;
        histogram[Math.round(value)]++;
      }
    }
    const percentile = (percent) => {
      const target = (gray.length * percent) / 100;
      let sum = 0;
      for (let v = 0; v < 256; v++) { sum += histogram[v]; if (sum >= target) return v; }
      return 255;
    };
    const low = percentile(LEVEL_LOW_PERCENT);
    const high = Math.max(percentile(LEVEL_HIGH_PERCENT), low + 1);
    for (let i = 0; i < normalized.length; i++) {
      const stretched = Math.min(1, Math.max(0, (normalized[i] - low) / (high - low)));
      const out = Math.round(Math.pow(stretched, GAMMA) * 255);
      data[i * 4] = out;
      data[i * 4 + 1] = out;
      data[i * 4 + 2] = out;
      data[i * 4 + 3] = 255;
    }
    return data;
  }

  // ---- 原稿の読み込み（ブラウザの中だけ） ---------------------------------------

  const pages = new Map();            // ページ番号 → { label, draw: async (width) => canvas }
  const cache = [];                   // 描いたページの控え: { key, canvas }

  const pageNumberFromName = (name) => {
    const match = String(name).replace(/\.[^.]*$/, '').match(/(\d+)(?!.*\d)/);
    return match ? parseInt(match[1], 10) : null;
  };

  function loadScriptOnce(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = resolve;
      script.onerror = () => reject(new Error('PDFを開く部品を読み込めませんでした。インターネットにつながっているか確かめてください。'));
      document.head.appendChild(script);
    });
  }

  async function ensurePdfJs() {
    if (!root.pdfjsLib) await loadScriptOnce(root.SAKUBUN_PDFJS_URL || PDFJS_URL);
    if (!root.pdfjsLib) throw new Error('PDFを開く部品が使えません。画像（PNG・JPEG）にして読み込んでください。');
    root.pdfjsLib.GlobalWorkerOptions.workerSrc = root.SAKUBUN_PDFJS_WORKER_URL || PDFJS_WORKER_URL;
    return root.pdfjsLib;
  }

  async function addPdf(file) {
    const pdfjs = await ensurePdfJs();
    const document_ = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    for (let n = 1; n <= document_.numPages; n++) {
      pages.set(n, {
        label: file.name,
        draw: async (width) => {
          const page = await document_.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: width / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
          return canvas;
        },
      });
    }
    return document_.numPages;
  }

  async function addImage(file, fallbackNumber) {
    const bitmap = await createImageBitmap(file);
    const number = pageNumberFromName(file.name) || fallbackNumber;
    pages.set(number, {
      label: file.name,
      draw: async (width) => {
        const canvas = document.createElement('canvas');
        const scale = width / bitmap.width;
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas;
      },
    });
    return 1;
  }

  /** 選んだファイルを開く。画像のページ番号は、ファイル名の最後の数字（p01 なら 1）。無ければ並び順。 */
  async function addFiles(fileList) {
    const files = Array.from(fileList).sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
    let order = 0;
    let added = 0;
    for (const file of files) {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        added += await addPdf(file);
      } else if (/^image\//.test(file.type)) {
        order++;
        added += await addImage(file, order);
      }
    }
    cache.length = 0;
    return added;
  }

  const hasPages = () => pages.size > 0;
  const pageNumbers = () => Array.from(pages.keys()).sort((a, b) => a - b);
  const clear = () => { pages.clear(); cache.length = 0; };

  async function renderPage(number, enhance) {
    const entry = pages.get(number);
    if (!entry) return null;
    const key = number + (enhance ? ':e' : ':r');
    const hit = cache.find((item) => item.key === key);
    if (hit) return hit.canvas;
    const canvas = await entry.draw(RENDER_WIDTH);
    if (enhance) {
      const context = canvas.getContext('2d');
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      enhanceImageData(image.data, canvas.width, canvas.height);
      context.putImageData(image, 0, 0);
    }
    cache.push({ key: key, canvas: canvas });
    while (cache.length > CACHE_SIZE) cache.shift();
    return canvas;
  }

  // ---- 直す枠の横に出す画面 ---------------------------------------------------

  /**
   * parent の中に、原稿を見る画面を作る。
   * wantedPages: この作文のページ番号（無ければ全ページから選ぶ）
   */
  function mountViewer(parent, wantedPages) {
    const doc = parent.ownerDocument;
    const make = (tag, text, className) => {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const available = pageNumbers();
    const list = (wantedPages || []).filter((n) => pages.has(n));
    const shown = list.length > 0 ? list : available;
    const missing = (wantedPages || []).filter((n) => !pages.has(n));

    const box = make('div', undefined, 'source-viewer');
    box.appendChild(make('h3', '原稿'));
    if (missing.length > 0) {
      box.appendChild(make('p', 'ページ ' + missing.join('、') + ' の原稿は、読み込んだ原稿にありません。', 'note'));
    }
    const bar = make('div', undefined, 'row');
    const tabs = make('span');
    const enhanceLabel = make('label', ' 濃くする ');
    const enhanceBox = doc.createElement('input');
    enhanceBox.type = 'checkbox';
    enhanceBox.checked = true;
    enhanceLabel.insertBefore(enhanceBox, enhanceLabel.firstChild);
    const zoomOut = make('button', '－');
    const zoomIn = make('button', '＋');
    const zoomLabel = make('span', '', 'note');
    [tabs, enhanceLabel, zoomOut, zoomIn, zoomLabel].forEach((node) => bar.appendChild(node));
    box.appendChild(bar);
    const scroller = make('div', undefined, 'source-scroll');
    const placeholder = make('p', '読み込んでいます…', 'note');
    scroller.appendChild(placeholder);
    box.appendChild(scroller);
    parent.appendChild(box);

    let current = shown[0];
    let zoomIndex = DEFAULT_ZOOM_INDEX;
    let token = 0;

    async function draw() {
      const mine = ++token;
      zoomLabel.textContent = '　ページ ' + current + '　' + ZOOM_STEPS[zoomIndex] + '%';
      Array.from(tabs.children).forEach((button) => button.classList.toggle('active', Number(button.dataset.page) === current));
      const canvas = await renderPage(current, enhanceBox.checked);
      if (mine !== token) return;
      scroller.textContent = '';
      if (!canvas) { scroller.appendChild(make('p', 'このページの原稿がありません。', 'note')); return; }
      const shownCanvas = doc.createElement('canvas');
      shownCanvas.width = canvas.width;
      shownCanvas.height = canvas.height;
      shownCanvas.getContext('2d').drawImage(canvas, 0, 0);
      shownCanvas.style.width = ZOOM_STEPS[zoomIndex] + '%';
      scroller.appendChild(shownCanvas);
    }

    shown.forEach((number) => {
      const button = make('button', 'p.' + number);
      button.dataset.page = String(number);
      button.addEventListener('click', () => { current = number; draw(); });
      tabs.appendChild(button);
    });
    enhanceBox.addEventListener('change', draw);
    zoomIn.addEventListener('click', () => { zoomIndex = Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1); draw(); });
    zoomOut.addEventListener('click', () => { zoomIndex = Math.max(0, zoomIndex - 1); draw(); });
    if (current !== undefined) {
      draw().catch((error) => { scroller.textContent = error.message; });
    } else {
      placeholder.textContent = '原稿が読み込まれていません。';
    }
    return box;
  }

  const api = { enhanceImageData, addFiles, hasPages, pageNumbers, clear, renderPage, mountViewer, pageNumberFromName };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.SakubunSource = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
