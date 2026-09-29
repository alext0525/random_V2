'use strict';
const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

/* ---------- lifecycle: let the launcher exit when the tab closes ---------- */
fetch('/api/hello').catch(() => {});
window.addEventListener('pagehide', () => navigator.sendBeacon && navigator.sendBeacon('/api/bye'));

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const fmtSize = (n) => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
const baseName = (n) => n.replace(/\.[^.]+$/, '');
const extOf = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readBuf = (f) => f.arrayBuffer();
const tick = () => new Promise((r) => setTimeout(r, 0));

function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function status(id, msg, kind) {
  const el = $(id);
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = msg || '';
}

async function run(btnId, statusId, fn) {
  const btn = $(btnId);
  btn.disabled = true;
  try {
    status(statusId, 'Working…');
    const msg = await fn((m) => status(statusId, m));
    if (msg) status(statusId, msg, 'ok');
  } catch (e) {
    console.error(e);
    status(statusId, 'Error: ' + (e && e.message || e), 'err');
  } finally {
    btn.disabled = false;
  }
}

async function saveMany(outputs, zipName) {
  // outputs: [{name, data(Uint8Array|Blob), type}]
  if (outputs.length === 1) {
    const o = outputs[0];
    download(o.data, o.name, o.type);
    return o.name;
  }
  const zip = new JSZip();
  outputs.forEach((o) => zip.file(o.name, o.data));
  download(await zip.generateAsync({ type: 'blob' }), zipName);
  return zipName;
}

const canvasBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));
const canvasBytes = async (c, type, q) => new Uint8Array(await (await canvasBlob(c, type, q)).arrayBuffer());

/* ---------- navigation ---------- */
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#nav button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === b.dataset.tab));
}));

/* ---------- file lists / drop zones ---------- */
const picker = $('picker');
const lists = {};      // target -> {items:[File], multiple, accept, onChange}

function setupTarget(target, { multiple, accept, onChange, listEl }) {
  const t = lists[target] = { items: [], multiple, accept, onChange, listEl };
  const drop = document.querySelector(`.drop[data-target="${target}"]`);
  const add = (files) => {
    files = [...files];
    if (accept) files = files.filter((f) => accept.test(f.name));
    if (!files.length) return;
    t.items = multiple ? t.items.concat(files) : [files[0]];
    renderList(target);
    t.pending = onChange && onChange(t.items);
  };
  drop.addEventListener('click', () => {
    picker.multiple = multiple;
    picker.value = '';
    picker.onchange = () => add(picker.files);
    picker.click();
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); add(e.dataTransfer.files); });
  return t;
}

function renderList(target) {
  const t = lists[target];
  if (!t.listEl) return;
  t.listEl.innerHTML = '';
  t.items.forEach((f, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="name">${esc(f.name)}</span><span class="size">${fmtSize(f.size)}</span>`;
    const mk = (label, fn, disabled) => {
      const b = document.createElement('button');
      b.textContent = label; b.disabled = !!disabled; b.onclick = fn; li.appendChild(b);
    };
    if (t.multiple && t.reorder) {
      mk('↑', () => { [t.items[i - 1], t.items[i]] = [t.items[i], t.items[i - 1]]; renderList(target); }, i === 0);
      mk('↓', () => { [t.items[i + 1], t.items[i]] = [t.items[i], t.items[i + 1]]; renderList(target); }, i === t.items.length - 1);
    }
    mk('✕', () => { t.items.splice(i, 1); renderList(target); t.onChange && t.onChange(t.items); });
    t.listEl.appendChild(li);
  });
}

/* ---------- pdf.js helpers ---------- */
async function openPdfJs(buf) {
  return pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
}

async function renderPage(pdf, pageNo, scale) {
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(vp.width));
  c.height = Math.max(1, Math.ceil(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const v1 = page.getViewport({ scale: 1 });
  page.cleanup();
  return { canvas: c, wPt: v1.width, hPt: v1.height };
}

async function loadPdfLib(buf) {
  return PDFDocument.load(buf, { ignoreEncryption: true });
}

/* Parse "1-3, 5, 8-" -> array of arrays of 0-based page indices */
function parseRanges(str, total) {
  const parts = [];
  for (let seg of str.split(',')) {
    seg = seg.trim();
    if (!seg) continue;
    const m = seg.match(/^(\d*)\s*-\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    else if (/^\d+$/.test(seg)) { a = b = +seg; }
    else throw new Error(`Invalid range "${seg}"`);
    if (a < 1 || b > total || a > b) throw new Error(`Range "${seg}" is outside 1–${total}`);
    const idx = [];
    for (let p = a; p <= b; p++) idx.push(p - 1);
    parts.push(idx);
  }
  if (!parts.length) throw new Error('Enter at least one page or range');
  return parts;
}

/* ============================================================
   CONVERT ANYTHING -> PDF
   ============================================================ */
const IMG_EXT = /^(jpe?g|png|gif|webp|bmp|svg|avif|ico)$/;
const TEXT_EXT = /^(txt|log|json|xml|yml|yaml|ini|cfg|conf|js|ts|py|java|c|cpp|h|css|sql|sh|bat|tex|rtf)$/;
const SHEET_EXT = /^(xlsx|xlsm|xls|ods|csv|tsv)$/;
const ANY_INPUT = /\.(pdf|jpe?g|png|gif|webp|bmp|svg|avif|ico|docx|xlsx|xlsm|xls|ods|csv|tsv|pptx|md|markdown|html?|txt|log|json|xml|yml|yaml|ini|cfg|conf|js|ts|py|java|c|cpp|h|css|sql|sh|bat|tex|rtf)$/i;

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot decode image')); };
    img.src = url;
  });
}

async function imageToCanvas(file) {
  let blob = file;
  if (extOf(file.name) === 'svg') blob = new Blob([await file.text()], { type: 'image/svg+xml' });
  const img = await loadImage(blob);
  const w = img.naturalWidth || 800, h = img.naturalHeight || 600;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c;
}

async function addImagePage(doc, file, sizeMode) {
  const ext = extOf(file.name);
  let image, w, h;
  if (ext === 'png') {
    image = await doc.embedPng(await readBuf(file));
  } else {
    // Route through canvas so EXIF rotation, WebP, GIF, BMP, SVG etc. all work.
    const c = await imageToCanvas(file);
    const hasAlpha = ext !== 'jpg' && ext !== 'jpeg';
    image = hasAlpha ? await doc.embedPng(await canvasBytes(c, 'image/png'))
                     : await doc.embedJpg(await canvasBytes(c, 'image/jpeg', 0.95));
  }
  w = image.width * 0.75; h = image.height * 0.75; // px -> pt at 96 dpi
  if (sizeMode === 'fit') {
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    return;
  }
  let [pw, ph] = PAGE_SIZES[sizeMode] || PAGE_SIZES.a4;
  if (w > h) [pw, ph] = [ph, pw];
  const m = 24, s = Math.min((pw - 2 * m) / w, (ph - 2 * m) / h, 1);
  const dw = w * s, dh = h * s;
  doc.addPage([pw, ph]).drawImage(image, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
}

/* Plain text -> real text PDF (Latin-1 only; otherwise falls back to HTML render) */
const LATIN1 = /^[\t\n\r\x20-\x7E\xA0-\xFF]*$/;
async function addTextPages(doc, text, sizeMode) {
  const [pw, ph] = PAGE_SIZES[sizeMode] || PAGE_SIZES.a4;
  const font = await doc.embedFont(StandardFonts.Courier);
  const size = 10, lh = 13, m = 54;
  const maxW = pw - 2 * m;
  const lines = [];
  for (const raw of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    if (!raw) { lines.push(''); continue; }
    let cur = '';
    for (const ch of raw) {
      if (font.widthOfTextAtSize(cur + ch, size) > maxW) { lines.push(cur); cur = ch; } else cur += ch;
    }
    lines.push(cur);
  }
  const perPage = Math.floor((ph - 2 * m) / lh);
  for (let i = 0; i < Math.max(lines.length, 1); i += perPage) {
    const page = doc.addPage([pw, ph]);
    lines.slice(i, i + perPage).forEach((ln, j) => {
      if (ln) page.drawText(ln, { x: m, y: ph - m - size - j * lh, size, font, color: rgb(0, 0, 0) });
    });
  }
}

/* Strip active content from untrusted HTML before it touches our DOM */
function sanitizeHtml(html) {
  const d = new DOMParser().parseFromString(html, 'text/html');
  d.querySelectorAll('script,iframe,object,embed,link,meta,base,form,audio,video').forEach((n) => n.remove());
  d.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith('on') || v.startsWith('javascript:') ||
          ((a.name === 'src' || a.name === 'href') && /^(https?:)?\/\//.test(v))) el.removeAttribute(a.name);
    }
  });
  return d.body.innerHTML + [...d.querySelectorAll('style')].map((s) => s.outerHTML).join('');
}

const DOC_CSS = `font:14px/1.5 "Segoe UI",Arial,sans-serif;color:#111;background:#fff;
  word-wrap:break-word;overflow-wrap:anywhere`;

/* Render an HTML string to paginated image pages */
async function addHtmlPages(doc, html, sizeMode) {
  const [pw, ph] = PAGE_SIZES[sizeMode] || PAGE_SIZES.a4;
  const widthPx = Math.round(pw * 96 / 72);
  const marginPx = 48;
  const pageContentPx = Math.round(ph * 96 / 72) - 2 * marginPx;
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-100000px;top:0;width:${widthPx}px;padding:0 ${marginPx}px;box-sizing:border-box;${DOC_CSS}`;
  host.innerHTML = `<style>
    .pdfdoc table{border-collapse:collapse;max-width:100%;font-size:12px}
    .pdfdoc td,.pdfdoc th{border:1px solid #999;padding:3px 6px;vertical-align:top}
    .pdfdoc img{max-width:100%;height:auto}
    .pdfdoc pre,.pdfdoc code{font-family:Consolas,monospace;background:#f4f4f4}
    .pdfdoc pre{padding:8px;white-space:pre-wrap}
    .pdfdoc blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:12px;color:#444}
    .pdfdoc h1,.pdfdoc h2,.pdfdoc h3{line-height:1.25}
  </style><div class="pdfdoc">${html}</div>`;
  document.body.appendChild(host);
  try {
    await Promise.all([...host.querySelectorAll('img')].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    const total = Math.max(host.scrollHeight, 1);
    const scale = 1.5;
    for (let y = 0; y < total; y += pageContentPx) {
      const h = Math.min(pageContentPx, total - y);
      const c = await html2canvas(host, {
        scale, backgroundColor: '#fff', x: 0, y, width: widthPx, height: h,
        windowWidth: widthPx, scrollX: 0, scrollY: 0, logging: false,
      });
      const img = await doc.embedJpg(await canvasBytes(c, 'image/jpeg', 0.9));
      const page = doc.addPage([pw, ph]);
      const k = pw / widthPx;
      page.drawImage(img, { x: 0, y: ph - marginPx * k - h * k, width: widthPx * k, height: h * k });
      await tick();
    }
  } finally {
    host.remove();
  }
}

async function pptxToHtml(buf) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]));
  let html = '';
  for (let i = 0; i < slides.length; i++) {
    const xml = new DOMParser().parseFromString(await zip.file(slides[i]).async('string'), 'application/xml');
    const paras = [...xml.getElementsByTagName('a:p')]
      .map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join(''))
      .filter(Boolean);
    html += `<h2 style="border-bottom:2px solid #444;margin-top:28px">Slide ${i + 1}</h2>` +
      paras.map((p, k) => k === 0 ? `<h3>${esc(p)}</h3>` : `<p>${esc(p)}</p>`).join('');
  }
  return html || '<p>(no slide text found)</p>';
}

/* Convert any supported file to HTML for the renderer. Returns null for pdf/image/plain text. */
async function fileToHtml(file) {
  const ext = extOf(file.name);
  if (ext === 'docx') {
    const r = await mammoth.convertToHtml({ arrayBuffer: await readBuf(file) });
    return sanitizeHtml(r.value);
  }
  if (SHEET_EXT.test(ext)) {
    const wb = XLSX.read(await readBuf(file), { type: 'array' });
    return wb.SheetNames.map((n) => `<h3>${esc(n)}</h3>` + XLSX.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })
      .replace(/^.*?<body>|<\/body>.*$/gs, '')).join('<br>');
  }
  if (ext === 'pptx') return pptxToHtml(await readBuf(file));
  if (ext === 'md' || ext === 'markdown') return sanitizeHtml(marked.parse(await file.text()));
  if (ext === 'html' || ext === 'htm') return sanitizeHtml(await file.text());
  return null;
}

/* Any supported file -> PDFDocument (single doc) */
async function fileToPdfDoc(file, sizeMode) {
  const ext = extOf(file.name);
  if (ext === 'pdf') return loadPdfLib(await readBuf(file));
  if (ext === 'doc' || ext === 'ppt') throw new Error(`${file.name}: legacy .${ext} is not supported, save it as .${ext}x first`);
  const doc = await PDFDocument.create();
  if (IMG_EXT.test(ext)) { await addImagePage(doc, file, sizeMode); return doc; }
  const html = await fileToHtml(file);
  if (html != null) { await addHtmlPages(doc, html, sizeMode === 'fit' ? 'a4' : sizeMode); return doc; }
  const text = await file.text();
  if (LATIN1.test(text)) await addTextPages(doc, text, sizeMode === 'fit' ? 'a4' : sizeMode);
  else await addHtmlPages(doc, `<pre style="white-space:pre-wrap;font-family:Consolas,monospace">${esc(text)}</pre>`, sizeMode === 'fit' ? 'a4' : sizeMode);
  return doc;
}

async function mergeDocs(docs) {
  const out = await PDFDocument.create();
  for (const d of docs) {
    const pages = await out.copyPages(d, d.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out;
}

/* ============================================================
   MERGE
   ============================================================ */
setupTarget('merge', { multiple: true, accept: ANY_INPUT, listEl: $('merge-list') }).reorder = true;
$('merge-go').onclick = () => run('merge-go', 'merge-status', async (say) => {
  const files = lists.merge.items;
  if (files.length < 2) throw new Error('Add at least two files');
  const docs = [];
  for (let i = 0; i < files.length; i++) {
    say(`Reading ${files[i].name} (${i + 1}/${files.length})…`);
    docs.push(await fileToPdfDoc(files[i], 'a4'));
  }
  say('Merging…');
  const out = await mergeDocs(docs);
  const bytes = await out.save();
  download(bytes, 'merged.pdf', 'application/pdf');
  return `Done: merged.pdf, ${out.getPageCount()} pages, ${fmtSize(bytes.length)}`;
});

/* ============================================================
   SPLIT
   ============================================================ */
let splitDoc = null;
setupTarget('split', {
  multiple: false, accept: /\.pdf$/i,
  onChange: async ([f]) => {
    try {
      splitDoc = await loadPdfLib(await readBuf(f));
      $('split-info').textContent = `${f.name}: ${splitDoc.getPageCount()} pages`;
    } catch (e) { splitDoc = null; status('split-status', 'Cannot read PDF: ' + e.message, 'err'); }
  },
});
const splitModeUi = () => {
  const m = $('split-mode').value;
  $('split-ranges-l').hidden = !(m === 'ranges' || m === 'extract' || m === 'remove');
  $('split-n-l').hidden = m !== 'every';
};
$('split-mode').onchange = splitModeUi; splitModeUi();

async function extractPages(src, idx) {
  const d = await PDFDocument.create();
  (await d.copyPages(src, idx)).forEach((p) => d.addPage(p));
  return d.save();
}

$('split-go').onclick = () => run('split-go', 'split-status', async (say) => {
  await lists.split.pending;
  if (!splitDoc) throw new Error('Choose a PDF first');
  const n = splitDoc.getPageCount();
  const base = baseName(lists.split.items[0].name);
  const mode = $('split-mode').value;
  let groups;
  if (mode === 'ranges') groups = parseRanges($('split-ranges').value, n);
  else if (mode === 'extract') groups = [parseRanges($('split-ranges').value, n).flat()];
  else if (mode === 'remove') {
    const rm = new Set(parseRanges($('split-ranges').value, n).flat());
    const keep = [...Array(n).keys()].filter((i) => !rm.has(i));
    if (!keep.length) throw new Error('Cannot remove every page');
    groups = [keep];
  } else if (mode === 'every') {
    const k = Math.max(1, parseInt($('split-n').value) || 1);
    groups = [];
    for (let i = 0; i < n; i += k) groups.push([...Array(Math.min(k, n - i)).keys()].map((j) => i + j));
  } else groups = [...Array(n).keys()].map((i) => [i]);

  const outs = [];
  for (let i = 0; i < groups.length; i++) {
    say(`Building part ${i + 1}/${groups.length}…`);
    const g = groups[i];
    const label = mode === 'extract' ? 'extract' : mode === 'remove' ? 'trimmed'
      : g.length === 1 ? `page${g[0] + 1}` : `pages${g[0] + 1}-${g[g.length - 1] + 1}`;
    outs.push({ name: `${base}_${label}.pdf`, data: await extractPages(splitDoc, g), type: 'application/pdf' });
  }
  // Ensure unique names inside a zip
  const seen = {};
  outs.forEach((o) => { seen[o.name] = (seen[o.name] || 0) + 1; if (seen[o.name] > 1) o.name = o.name.replace('.pdf', `_${seen[o.name]}.pdf`); });
  const saved = await saveMany(outs, `${base}_split.zip`);
  return `Done: ${outs.length} file(s) → ${saved}`;
});

/* ============================================================
   ORGANIZE
   ============================================================ */
let org = { buf: null, pages: [] }; // pages: {src:index|-1(blank), rot, canvas, w, h}
setupTarget('organize', {
  multiple: false, accept: /\.pdf$/i,
  onChange: async ([f]) => {
    try {
      status('org-status', 'Rendering thumbnails…');
      org.buf = await readBuf(f);
      const pdf = await openPdfJs(org.buf);
      const rl = await loadPdfLib(org.buf);
      org.pages = [];
      $('org-thumbs').innerHTML = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const r = await renderPage(pdf, i, 0.3);
        org.pages.push({ src: i - 1, rot: rl.getPage(i - 1).getRotation().angle, baseRot: rl.getPage(i - 1).getRotation().angle, canvas: r.canvas, w: r.wPt, h: r.hPt });
        if (i % 8 === 0) { drawOrg(); await tick(); }
      }
      drawOrg();
      status('org-status', `${org.pages.length} pages`);
    } catch (e) { status('org-status', 'Cannot read PDF: ' + e.message, 'err'); }
  },
});

function drawOrg() {
  const box = $('org-thumbs');
  box.innerHTML = '';
  org.pages.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    const cv = document.createElement('div'); cv.className = 'cv';
    const c = document.createElement('canvas');
    c.width = p.canvas.width; c.height = p.canvas.height;
    c.getContext('2d').drawImage(p.canvas, 0, 0);
    c.style.transform = `rotate(${p.rot - p.baseRot}deg)`;
    cv.appendChild(c);
    d.appendChild(cv);
    d.insertAdjacentHTML('beforeend', `<small>${i + 1}${p.src < 0 ? ' (blank)' : ''}</small>`);
    const bar = document.createElement('div'); bar.className = 'bar';
    const btn = (t, title, fn) => { const b = document.createElement('button'); b.textContent = t; b.title = title; b.onclick = fn; bar.appendChild(b); };
    btn('←', 'Move left', () => { if (i > 0) { [org.pages[i - 1], org.pages[i]] = [org.pages[i], org.pages[i - 1]]; drawOrg(); } });
    btn('⟲', 'Rotate left', () => { p.rot = (p.rot + 270) % 360; drawOrg(); });
    btn('⟳', 'Rotate right', () => { p.rot = (p.rot + 90) % 360; drawOrg(); });
    btn('✕', 'Delete', () => { org.pages.splice(i, 1); drawOrg(); });
    btn('→', 'Move right', () => { if (i < org.pages.length - 1) { [org.pages[i + 1], org.pages[i]] = [org.pages[i], org.pages[i + 1]]; drawOrg(); } });
    d.appendChild(bar);
    box.appendChild(d);
  });
}
$('org-rotl').onclick = () => { org.pages.forEach((p) => p.rot = (p.rot + 270) % 360); drawOrg(); };
$('org-rotr').onclick = () => { org.pages.forEach((p) => p.rot = (p.rot + 90) % 360); drawOrg(); };
$('org-reverse').onclick = () => { org.pages.reverse(); drawOrg(); };
$('org-blank').onclick = () => {
  if (!org.buf) return;
  const c = document.createElement('canvas'); c.width = 180; c.height = 240;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 180, 240);
  org.pages.push({ src: -1, rot: 0, baseRot: 0, canvas: c, w: 595.28, h: 841.89 });
  drawOrg();
};
$('org-go').onclick = () => run('org-go', 'org-status', async () => {
  await lists.organize.pending;
  if (!org.buf || !org.pages.length) throw new Error('Nothing to save');
  const src = await loadPdfLib(org.buf);
  const out = await PDFDocument.create();
  for (const p of org.pages) {
    if (p.src < 0) { out.addPage([p.w, p.h]); continue; }
    const [pg] = await out.copyPages(src, [p.src]);
    pg.setRotation(degrees(p.rot));
    out.addPage(pg);
  }
  const bytes = await out.save();
  download(bytes, baseName(lists.organize.items[0].name) + '_organized.pdf', 'application/pdf');
  return `Saved ${out.getPageCount()} pages, ${fmtSize(bytes.length)}`;
});

/* ============================================================
   COMPRESS
   ============================================================ */
const LEVELS = { medium: { scale: 1.5, q: 0.7 }, high: { scale: 1.0, q: 0.5 }, extreme: { scale: 0.7, q: 0.35 } };
setupTarget('compress', { multiple: true, accept: /\.pdf$/i, listEl: $('compress-list') });

async function compressPdf(file, level, say) {
  const buf = await readBuf(file);
  if (level === 'lossless') {
    const d = await loadPdfLib(buf);
    d.setProducer('PDF Toolkit'); d.setCreator('PDF Toolkit');
    return d.save({ useObjectStreams: true });
  }
  const { scale, q } = LEVELS[level];
  const pdf = await openPdfJs(buf);
  const out = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    say(`${file.name}: page ${i}/${pdf.numPages}`);
    const r = await renderPage(pdf, i, scale);
    const img = await out.embedJpg(await canvasBytes(r.canvas, 'image/jpeg', q));
    out.addPage([r.wPt, r.hPt]).drawImage(img, { x: 0, y: 0, width: r.wPt, height: r.hPt });
    r.canvas.width = r.canvas.height = 0;
    await tick();
  }
  return out.save({ useObjectStreams: true });
}

$('compress-go').onclick = () => run('compress-go', 'compress-status', async (say) => {
  const files = lists.compress.items;
  if (!files.length) throw new Error('Add at least one PDF');
  const level = $('compress-level').value;
  const outs = [], lines = [];
  for (const f of files) {
    let bytes = await compressPdf(f, level, say);
    let note = '';
    if (bytes.length >= f.size) { bytes = new Uint8Array(await readBuf(f)); note = ' (not smaller, original kept)'; }
    const pct = Math.round((1 - bytes.length / f.size) * 100);
    lines.push(`${f.name}: ${fmtSize(f.size)} → ${fmtSize(bytes.length)} (−${pct}%)${note}`);
    outs.push({ name: baseName(f.name) + '_compressed.pdf', data: bytes, type: 'application/pdf' });
  }
  await saveMany(outs, 'compressed_pdfs.zip');
  return lines.join('\n');
});

/* ============================================================
   CONVERT TO PDF
   ============================================================ */
setupTarget('toPdf', { multiple: true, accept: ANY_INPUT, listEl: $('toPdf-list') }).reorder = true;
$('toPdf-go').onclick = () => run('toPdf-go', 'toPdf-status', async (say) => {
  const files = lists.toPdf.items;
  if (!files.length) throw new Error('Add at least one file');
  const size = $('topdf-size').value;
  const combine = $('topdf-combine').checked;
  const docs = [], names = [], errors = [];
  for (let i = 0; i < files.length; i++) {
    say(`Converting ${files[i].name} (${i + 1}/${files.length})…`);
    try { docs.push(await fileToPdfDoc(files[i], size)); names.push(files[i].name); }
    catch (e) { errors.push(`${files[i].name}: ${e.message}`); }
  }
  if (!docs.length) throw new Error(errors.join('\n'));
  let saved;
  if (combine || docs.length === 1) {
    const out = docs.length === 1 ? docs[0] : await mergeDocs(docs);
    saved = await saveMany([{ name: (docs.length === 1 ? baseName(names[0]) : 'combined') + '.pdf', data: await out.save(), type: 'application/pdf' }], '');
  } else {
    const outs = [];
    for (let i = 0; i < docs.length; i++) outs.push({ name: baseName(names[i]) + '.pdf', data: await docs[i].save(), type: 'application/pdf' });
    saved = await saveMany(outs, 'converted_pdfs.zip');
  }
  return `Done → ${saved}` + (errors.length ? '\nSkipped:\n' + errors.join('\n') : '');
});

/* ============================================================
   PDF -> OTHER
   ============================================================ */
let fromBuf = null, fromPdfJs = null;
setupTarget('fromPdf', {
  multiple: false, accept: /\.pdf$/i,
  onChange: async ([f]) => {
    try {
      fromBuf = await readBuf(f);
      fromPdfJs = await openPdfJs(fromBuf);
      $('from-info').textContent = `${f.name}: ${fromPdfJs.numPages} pages`;
    } catch (e) { fromPdfJs = null; status('from-status', 'Cannot read PDF: ' + e.message, 'err'); }
  },
});
$('from-fmt').onchange = () => { $('from-dpi-l').hidden = !/^(png|jpg|webp)$/.test($('from-fmt').value); };

async function pageLines(pdf, no) {
  const page = await pdf.getPage(no);
  const tc = await page.getTextContent();
  const lines = [];
  let cur = null;
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const y = it.transform[5];
    if (cur && Math.abs(cur.y - y) < 2.5) cur.s += (cur.s && it.str && !/\s$/.test(cur.s) && it.transform[4] - cur.end > 1.5 ? ' ' : '') + it.str;
    else { cur = { y, s: it.str, h: it.height }; lines.push(cur); }
    cur.end = it.transform[4] + it.width;
    if (it.hasEOL) cur = null;
  }
  // group lines into paragraphs by vertical gap
  const paras = []; let p = [], prev = null;
  for (const l of lines) {
    if (!l.s.trim()) { prev = null; if (p.length) { paras.push(p.join(' ')); p = []; } continue; }
    if (prev && (prev.y - l.y) > (prev.h || 10) * 1.9 && p.length) { paras.push(p.join(' ')); p = []; }
    p.push(l.s.trim()); prev = l;
  }
  if (p.length) paras.push(p.join(' '));
  return paras;
}

function buildDocx(pagesParas) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  let body = '';
  pagesParas.forEach((paras, i) => {
    paras.forEach((t, k) => {
      const br = i > 0 && k === 0 ? '<w:r><w:br w:type="page"/></w:r>' : '';
      body += `<w:p>${br}<w:r><w:t xml:space="preserve">${esc(t).replace(/&#39;/g, "'").replace(/&quot;/g, '"')}</w:t></w:r></w:p>`;
    });
  });
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

$('from-go').onclick = () => run('from-go', 'from-status', async (say) => {
  await lists.fromPdf.pending;
  if (!fromPdfJs) throw new Error('Choose a PDF first');
  const n = fromPdfJs.numPages;
  const base = baseName(lists.fromPdf.items[0].name);
  const pagesStr = $('from-pages').value.trim();
  const pages = (pagesStr ? parseRanges(pagesStr, n).flat() : [...Array(n).keys()]).map((i) => i + 1);
  const fmt = $('from-fmt').value;

  if (/^(png|jpg|webp)$/.test(fmt)) {
    const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt];
    const scale = +$('from-dpi').value;
    const outs = [];
    for (const no of pages) {
      say(`Rendering page ${no}…`);
      const r = await renderPage(fromPdfJs, no, scale);
      outs.push({ name: `${base}_page${no}.${fmt}`, data: await canvasBlob(r.canvas, mime, 0.92), type: mime });
      r.canvas.width = r.canvas.height = 0;
      await tick();
    }
    await saveMany(outs, `${base}_images.zip`);
    return `Done: ${outs.length} image(s)`;
  }

  const all = [];
  for (const no of pages) { say(`Extracting text, page ${no}…`); all.push(await pageLines(fromPdfJs, no)); }
  if (!all.some((p) => p.length)) throw new Error('No text found. This PDF looks scanned (image only); use the image export instead.');
  if (fmt === 'txt') {
    download(new Blob([all.map((p) => p.join('\n\n')).join('\n\n\f\n')], { type: 'text/plain' }), base + '.txt');
  } else if (fmt === 'docx') {
    download(await buildDocx(all), base + '.docx');
  } else {
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(base)}</title><body style="max-width:800px;margin:2em auto;font:16px/1.5 sans-serif">` +
      all.map((p, i) => `<section><h4>Page ${pages[i]}</h4>${p.map((t) => `<p>${esc(t)}</p>`).join('')}</section>`).join('<hr>');
    download(new Blob([html], { type: 'text/html' }), base + '.html');
  }
  return 'Done';
});

/* ============================================================
   IMAGE CONVERTER
   ============================================================ */
setupTarget('images', { multiple: true, accept: /\.(jpe?g|png|gif|webp|bmp|svg|avif|ico)$/i, listEl: $('images-list') });
$('images-go').onclick = () => run('images-go', 'images-status', async (say) => {
  const files = lists.images.items;
  if (!files.length) throw new Error('Add at least one image');
  const fmt = $('img-fmt').value;
  const mime = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[fmt];
  const q = Math.min(100, Math.max(1, +$('img-q').value || 90)) / 100;
  const maxW = +$('img-w').value || 0;
  const outs = [];
  for (const f of files) {
    say(`Converting ${f.name}…`);
    let c = await imageToCanvas(f);
    if (maxW && c.width > maxW) {
      const s = document.createElement('canvas');
      s.width = maxW; s.height = Math.round(c.height * maxW / c.width);
      s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
      c = s;
    }
    if (fmt === 'jpg') { // flatten transparency onto white
      const f2 = document.createElement('canvas'); f2.width = c.width; f2.height = c.height;
      const x = f2.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(c, 0, 0); c = f2;
    }
    outs.push({ name: `${baseName(f.name)}.${fmt}`, data: await canvasBlob(c, mime, q), type: mime });
  }
  const seen = {};
  outs.forEach((o) => { seen[o.name] = (seen[o.name] || 0) + 1; if (seen[o.name] > 1) o.name = o.name.replace(/(\.[^.]+)$/, `_${seen[o.name]}$1`); });
  await saveMany(outs, 'converted_images.zip');
  return `Done: ${outs.length} image(s)`;
});

/* ============================================================
   EXTRAS: watermark, page numbers, metadata
   ============================================================ */
let extrasDoc = null;
setupTarget('extras', {
  multiple: false, accept: /\.pdf$/i,
  onChange: async ([f]) => {
    try {
      extrasDoc = await readBuf(f);
      const d = await loadPdfLib(extrasDoc);
      $('extras-info').textContent = `${f.name}: ${d.getPageCount()} pages`;
      $('md-title').value = d.getTitle() || '';
      $('md-author').value = d.getAuthor() || '';
      $('md-subject').value = d.getSubject() || '';
      $('md-keywords').value = d.getKeywords() || '';
    } catch (e) { extrasDoc = null; status('extras-status', 'Cannot read PDF: ' + e.message, 'err'); }
  },
});

$('extras-go').onclick = () => run('extras-go', 'extras-status', async () => {
  await lists.extras.pending;
  if (!extrasDoc) throw new Error('Choose a PDF first');
  const d = await loadPdfLib(extrasDoc);
  const font = await d.embedFont(StandardFonts.HelveticaBold);
  const pages = d.getPages();
  const wm = $('wm-text').value;
  if (wm) {
    const size = +$('wm-size').value || 72, op = (+$('wm-op').value || 25) / 100;
    for (const p of pages) {
      const { width, height } = p.getSize();
      const tw = font.widthOfTextAtSize(wm, size);
      const a = Math.PI / 4;
      p.drawText(wm, {
        x: width / 2 - (tw / 2) * Math.cos(a) + (size / 3) * Math.sin(a),
        y: height / 2 - (tw / 2) * Math.sin(a) - (size / 3) * Math.cos(a),
        size, font, color: rgb(0.5, 0.5, 0.5), opacity: op, rotate: degrees(45),
      });
    }
  }
  if ($('pn-on').checked) {
    const fmt = $('pn-fmt').value || '{n}';
    const pos = $('pn-pos').value, size = 10;
    pages.forEach((p, i) => {
      const t = fmt.replace('{n}', i + 1).replace('{total}', pages.length);
      const { width, height } = p.getSize();
      const tw = font.widthOfTextAtSize(t, size);
      const x = pos.endsWith('c') ? (width - tw) / 2 : pos.endsWith('r') ? width - tw - 36 : 36;
      const y = pos[0] === 'b' ? 24 : height - 32;
      p.drawText(t, { x, y, size, font, color: rgb(0.2, 0.2, 0.2) });
    });
  }
  d.setTitle($('md-title').value); d.setAuthor($('md-author').value);
  d.setSubject($('md-subject').value);
  d.setKeywords($('md-keywords').value.split(',').map((s) => s.trim()).filter(Boolean));
  const bytes = await d.save();
  download(bytes, baseName(lists.extras.items[0].name) + '_edited.pdf', 'application/pdf');
  return `Saved (${fmtSize(bytes.length)})`;
});
