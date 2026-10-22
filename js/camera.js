// camera.js — camera-assisted mapping.
// Calibrates the camera against a projector by flashing markers, then lets you
// trace objects and drag surface points directly on the live camera image.
import * as C from './core.js';

// ---------------------------------------------------------------- 3x3 + least squares

function mat3mul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}
function mat3inv(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  if (Math.abs(det) < 1e-15) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    if (Math.abs(d) < 1e-14) throw new Error('singular');
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
function normalizer(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let md = 0;
  for (const p of pts) md += Math.hypot(p.x - mx, p.y - my);
  const s = md ? Math.SQRT2 * n / md : 1;
  return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
}

// Least-squares homography camera→projector from [{cx,cy,px,py}].
export function fitHomography(pairs) {
  if (pairs.length < 4) return null;
  const Tc = normalizer(pairs.map(p => ({ x: p.cx, y: p.cy })));
  const Tp = normalizer(pairs.map(p => ({ x: p.px, y: p.py })));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const acc = (row, v) => { for (let i = 0; i < 8; i++) { Atb[i] += row[i] * v; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; } };
  for (const p of pairs) {
    const c = applyH(Tc, p.cx, p.cy), q = applyH(Tp, p.px, p.py);
    acc([c.x, c.y, 1, 0, 0, 0, -q.x * c.x, -q.x * c.y], q.x);
    acc([0, 0, 0, c.x, c.y, 1, -q.y * c.x, -q.y * c.y], q.y);
  }
  let h;
  try { h = solve(AtA, Atb); } catch { return null; }
  const Hn = [...h, 1];
  const Tpi = mat3inv(Tp);
  if (!Tpi) return null;
  const H = mat3mul(Tpi, mat3mul(Hn, Tc));
  return H.map(v => v / H[8]);
}

// Mapper with a smooth residual correction so curved scenes still land on their markers.
export function makeMapper(calib) {
  if (!calib || !calib.H) return null;
  const H = calib.H, Hi = mat3inv(H);
  if (!Hi) return null;
  const res = calib.pairs.map(p => { const q = applyH(H, p.cx, p.cy); return { cx: p.cx, cy: p.cy, rx: p.px - q.x, ry: p.py - q.y }; });
  const corr = (x, y) => {
    let sw = 0, sx = 0, sy = 0;
    for (const r of res) {
      const d2 = (x - r.cx) ** 2 + (y - r.cy) ** 2;
      if (d2 < 1e-12) return { x: r.rx, y: r.ry };
      const w = 1 / d2;
      sw += w; sx += w * r.rx; sy += w * r.ry;
    }
    return sw ? { x: sx / sw, y: sy / sw } : { x: 0, y: 0 };
  };
  const camToProj = (x, y) => { const q = applyH(H, x, y), c = corr(x, y); return { x: q.x + c.x, y: q.y + c.y }; };
  const projToCam = (x, y) => {
    let c = applyH(Hi, x, y);
    for (let i = 0; i < 8; i++) {
      const e = camToProj(c.x, c.y);
      const ex = e.x - x, ey = e.y - y;
      if (Math.abs(ex) + Math.abs(ey) < 1e-7) break;
      const h = 1e-4;
      const a = camToProj(c.x + h, c.y), b = camToProj(c.x, c.y + h);
      const j00 = (a.x - e.x) / h, j01 = (b.x - e.x) / h, j10 = (a.y - e.y) / h, j11 = (b.y - e.y) / h;
      const det = j00 * j11 - j01 * j10;
      if (Math.abs(det) < 1e-12) break;
      c = { x: c.x - (j11 * ex - j01 * ey) / det, y: c.y - (-j10 * ex + j00 * ey) / det };
    }
    return c;
  };
  const rms = Math.sqrt(res.reduce((s, r) => s + r.rx * r.rx + r.ry * r.ry, 0) / Math.max(1, res.length));
  return { camToProj, projToCam, rms };
}

export function markerGrid(n = 4, inset = 0.12) {
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push({ x: inset + (1 - 2 * inset) * c / (n - 1), y: inset + (1 - 2 * inset) * r / (n - 1), n: out.length + 1 });
  return out;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- panel

export class CameraPanel {
  // hooks: { getState, currentOutput, send(op), commit(rebuild), bc, toast, onSurfaceCreated }
  constructor(root, hooks) {
    this.root = root;
    this.hooks = hooks;
    this.stream = null;
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true;
    this.mode = null;           // null | {kind:'manual', i, pairs, markers} | {kind:'trace', pts} | {kind:'auto'}
    this.drag = null;
    this.mapperCache = { key: '', mapper: null };
    this.buildDom();
  }

  buildDom() {
    const r = this.root;
    r.innerHTML = `
      <div class="camBar">
        <select class="camSelect" title="Camera"></select>
        <button type="button" class="camStart">Start camera</button>
        <span class="sep"></span>
        <button type="button" class="camAuto" title="Flashes dots from the projector; the camera finds them">Calibrate (auto)</button>
        <button type="button" class="camManual" title="Shows all dots; you click each one in the camera image">Calibrate (click dots)</button>
        <button type="button" class="camClear">Clear</button>
        <span class="sep"></span>
        <button type="button" class="camTrace primary" title="Click the object's four corners in the camera image">Trace object</button>
        <button type="button" class="camCancel" hidden>Cancel</button>
        <span class="camStatus hint"></span>
      </div>
      <div class="camWrap"><canvas class="camVideo"></canvas><canvas class="camOverlay" tabindex="0"></canvas>
        <div class="camEmpty">Start the camera to see the room. Use the back camera and point it at the object from roughly where the projector is.</div></div>
      <div class="camHint hint"></div>`;
    this.$ = s => r.querySelector(s);
    this.canvas = this.$('.camVideo');
    this.overlay = this.$('.camOverlay');
    this.$('.camStart').addEventListener('click', () => (this.stream ? this.stop() : this.start()));
    this.$('.camSelect').addEventListener('change', () => { if (this.stream) this.start(); });
    this.$('.camAuto').addEventListener('click', () => this.calibrateAuto());
    this.$('.camManual').addEventListener('click', () => this.calibrateManual());
    this.$('.camClear').addEventListener('click', () => { const o = this.hooks.currentOutput(); if (o) { delete o.calib; this.hooks.commit(true); this.hooks.toast('Calibration cleared'); } });
    this.$('.camTrace').addEventListener('click', () => this.startTrace());
    this.$('.camCancel').addEventListener('click', () => this.cancel());
    this.overlay.addEventListener('pointerdown', e => this.onDown(e));
    this.overlay.addEventListener('pointermove', e => this.onMove(e));
    this.overlay.addEventListener('pointerup', e => this.onUp(e));
    this.overlay.addEventListener('pointercancel', e => this.onUp(e));
    this.overlay.addEventListener('keydown', e => this.onKey(e));
  }

  // ---------------------------------------------------------------- camera

  async start() {
    const sel = this.$('.camSelect');
    const constraints = sel.value
      ? { video: { deviceId: { exact: sel.value }, width: { ideal: 1920 }, height: { ideal: 1080 } } }
      : { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
    try {
      this.stop(false);
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;
      await this.video.play();
      this.$('.camStart').textContent = 'Stop camera';
      this.$('.camEmpty').style.display = 'none';
      await this.listCameras();
    } catch (e) {
      this.hooks.toast('Camera: ' + (e.message || e.name));
    }
  }

  stop(updateUi = true) {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    this.video.srcObject = null;
    if (updateUi) { this.$('.camStart').textContent = 'Start camera'; this.$('.camEmpty').style.display = ''; }
  }

  async listCameras() {
    const sel = this.$('.camSelect');
    const current = this.stream?.getVideoTracks()[0]?.getSettings().deviceId;
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    sel.replaceChildren();
    sel.append(new Option('Back camera (auto)', ''));
    for (const d of devs) sel.append(new Option(d.label || `Camera ${sel.length}`, d.deviceId));
    if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  }

  get ready() { return !!this.stream && this.video.videoWidth > 0; }

  // Luminance snapshot of the current frame, downscaled.
  capture(w = 480) {
    const vw = this.video.videoWidth, vh = this.video.videoHeight;
    const h = Math.round(w * vh / vw);
    const c = this.scratch || (this.scratch = document.createElement('canvas'));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.video, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
    return { w, h, lum };
  }

  async captureAvg(n = 2) {
    let acc = null;
    for (let i = 0; i < n; i++) {
      const f = this.capture();
      if (!acc) acc = f; else for (let k = 0; k < f.lum.length; k++) acc.lum[k] += f.lum[k];
      await wait(70);
    }
    for (let k = 0; k < acc.lum.length; k++) acc.lum[k] /= n;
    return acc;
  }

  // Finds the bright blob that appeared between dark and lit. Returns normalized camera coords or null.
  detect(dark, lit) {
    const { w, h } = lit;
    const diff = new Float32Array(w * h);
    let max = 0;
    for (let i = 0; i < diff.length; i++) { const v = lit.lum[i] - dark.lum[i]; diff[i] = v; if (v > max) max = v; }
    if (max < 25) return null;
    const thr = max * 0.55;
    let sw = 0, sx = 0, sy = 0, count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = diff[y * w + x];
      if (v >= thr) { sw += v; sx += v * x; sy += v * y; count++; }
    }
    if (count < 4 || count > w * h * 0.08) return null; // nothing, or the whole scene changed (exposure jump)
    return { x: (sx / sw + 0.5) / w, y: (sy / sw + 0.5) / h, strength: max };
  }

  projectorShow(o, mode, markers = []) {
    this.hooks.bc.postMessage({ type: 'calib', outputId: o.id, mode, markers });
  }

  // ---------------------------------------------------------------- calibration

  async calibrateAuto() {
    const o = this.hooks.currentOutput();
    if (!o) return this.hooks.toast('Select a projector first.');
    if (!this.ready) return this.hooks.toast('Start the camera first.');
    if (this.mode) return;
    this.mode = { kind: 'auto' };
    this.setBusy(true, 'Calibrating… keep the camera still');
    const markers = markerGrid(4);
    const pairs = [];
    try {
      this.projectorShow(o, 'black');
      await wait(900);
      let dark = await this.captureAvg(2);
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        this.projectorShow(o, 'marker', [m]);
        await wait(550);
        const lit = await this.captureAvg(2);
        const hit = this.detect(dark, lit);
        if (hit) pairs.push({ cx: hit.x, cy: hit.y, px: m.x, py: m.y });
        this.status(`Calibrating… dot ${i + 1}/${markers.length}, found ${pairs.length}`);
        this.projectorShow(o, 'black');
        await wait(250);
        if (i % 4 === 3) dark = await this.captureAvg(2); // follow slow exposure drift
      }
    } finally {
      this.projectorShow(o, 'off');
      this.setBusy(false);
      this.mode = null;
    }
    this.finishCalibration(o, pairs, markers.length);
  }

  calibrateManual() {
    const o = this.hooks.currentOutput();
    if (!o) return this.hooks.toast('Select a projector first.');
    if (!this.ready) return this.hooks.toast('Start the camera first.');
    if (this.mode) return;
    const markers = markerGrid(3);
    this.mode = { kind: 'manual', i: 0, pairs: [], markers, output: o };
    this.projectorShow(o, 'markers', markers);
    this.setBusy(true, `Click dot 1 of ${markers.length} in the camera image (Backspace = undo, Esc = stop)`);
    this.overlay.focus();
  }

  finishCalibration(o, pairs, total) {
    const H = fitHomography(pairs);
    if (!H || pairs.length < 4) {
      this.hooks.toast(`Only ${pairs.length} of ${total} dots found. Dim the room, point the camera at the whole projected area, or use "Calibrate (click dots)".`, 9000);
      return;
    }
    const cam = { w: this.video.videoWidth, h: this.video.videoHeight, deviceId: this.stream?.getVideoTracks()[0]?.getSettings().deviceId || null };
    o.calib = { pairs, H, cam, found: pairs.length, total, when: Date.now() };
    const m = makeMapper(o.calib);
    this.hooks.commit(true);
    this.hooks.toast(`Calibrated ${o.name}: ${pairs.length}/${total} dots, fit error ${(m.rms * o.width).toFixed(1)}px. Now trace an object or drag handles here.`, 8000);
  }

  // ---------------------------------------------------------------- trace

  startTrace() {
    const o = this.hooks.currentOutput();
    if (!o) return this.hooks.toast('Select a projector first.');
    if (!this.ready) return this.hooks.toast('Start the camera first.');
    if (!this.mapper(o)) return this.hooks.toast('Calibrate this projector first so clicks can be mapped to it.');
    if (this.mode) return;
    this.mode = { kind: 'trace', pts: [], output: o };
    this.setBusy(true, 'Click the object\'s corners: top-left, top-right, bottom-right, bottom-left (Backspace = undo, Esc = stop)');
    this.overlay.focus();
  }

  cancel() {
    if (this.mode?.kind === 'manual') this.projectorShow(this.mode.output, 'off');
    this.mode = null;
    this.setBusy(false);
  }

  setBusy(busy, msg = '') {
    for (const s of ['.camAuto', '.camManual', '.camTrace', '.camClear']) this.$(s).disabled = busy;
    this.$('.camCancel').hidden = !busy || this.mode?.kind === 'auto';
    this.status(msg);
  }
  status(msg) { this.$('.camStatus').textContent = msg; }

  mapper(o) {
    if (!o?.calib) return null;
    const key = o.id + ':' + (o.calib.when || 0);
    if (this.mapperCache.key !== key) this.mapperCache = { key, mapper: makeMapper(o.calib) };
    return this.mapperCache.mapper;
  }

  // ---------------------------------------------------------------- pointer

  toNorm(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, W: r.width, H: r.height };
  }

  onDown(e) {
    if (e.button !== 0 || !this.ready) return;
    this.overlay.focus();
    const p = this.toNorm(e);
    const o = this.hooks.currentOutput();
    const m = this.mode;
    if (m?.kind === 'manual') {
      const mk = m.markers[m.i];
      m.pairs.push({ cx: p.x, cy: p.y, px: mk.x, py: mk.y });
      m.i++;
      if (m.i >= m.markers.length) {
        this.projectorShow(m.output, 'off');
        const { pairs, markers, output } = m;
        this.mode = null; this.setBusy(false);
        this.finishCalibration(output, pairs, markers.length);
      } else this.status(`Click dot ${m.i + 1} of ${m.markers.length} (Backspace = undo, Esc = stop)`);
      return;
    }
    if (m?.kind === 'trace') {
      m.pts.push({ x: p.x, y: p.y });
      if (m.pts.length === 4) {
        const map = this.mapper(m.output);
        const q = m.pts.map(pt => map.camToProj(pt.x, pt.y));
        const s = C.makeSurface(m.output.surfaces.length + 1, this.hooks.getState().media.find(x => !x.missing)?.id ?? null);
        s.pts = [[q[0], q[1]], [q[3], q[2]]];
        s.fill = 'grid';
        m.output.surfaces.push(s);
        this.hooks.getState().selection = { outputId: m.output.id, surfaceId: s.id, point: null };
        this.mode = null; this.setBusy(false);
        this.hooks.commit(true);
        this.hooks.toast('Surface created on the object (shown as a grid). Drag its handles here, in the preview, or on the projector.');
      } else this.status(`Corner ${m.pts.length} of 4 placed — next: ${['top-right', 'bottom-right', 'bottom-left'][m.pts.length - 1]}`);
      return;
    }
    if (m) return;
    // normal: hit-test handles of the current output's surfaces (in camera space)
    const map = this.mapper(o);
    if (!o || !map) return;
    const sel = this.hooks.getState().selection;
    const order = [...o.surfaces].reverse();
    const first = order.find(s => s.id === sel.surfaceId);
    const cands = first ? [first, ...order.filter(s => s !== first)] : order;
    for (const s of cands) {
      for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
        const q = s.pts[r][c];
        const cp = map.projToCam(q.x, q.y);
        const dx = (cp.x - p.x) * p.W, dy = (cp.y - p.y) * p.H;
        if (dx * dx + dy * dy <= 144) {
          this.hooks.send({ type: 'select', outputId: o.id, surfaceId: s.id, point: { r, c } });
          if (!s.locked) { this.drag = { s, r, c, offX: p.x - cp.x, offY: p.y - cp.y, map }; this.overlay.setPointerCapture(e.pointerId); }
          return;
        }
      }
    }
    this.hooks.send({ type: 'select', outputId: o.id, surfaceId: null, point: null });
  }

  onMove(e) {
    if (!this.drag) return;
    const p = this.toNorm(e);
    const d = this.drag;
    const q = d.map.camToProj(p.x - d.offX, p.y - d.offY);
    this.hooks.send({ type: 'movePoint', surfaceId: d.s.id, r: d.r, c: d.c, x: q.x, y: q.y });
  }
  onUp(e) {
    if (this.drag) { try { this.overlay.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
    this.drag = null;
  }
  onKey(e) {
    const m = this.mode;
    if (e.key === 'Escape' && m) { this.cancel(); e.preventDefault(); }
    else if (e.key === 'Backspace' && m?.kind === 'manual' && m.i > 0) { m.i--; m.pairs.pop(); this.status(`Click dot ${m.i + 1} of ${m.markers.length}`); e.preventDefault(); }
    else if (e.key === 'Backspace' && m?.kind === 'trace' && m.pts.length) { m.pts.pop(); this.status(`Corner ${m.pts.length} of 4 placed`); e.preventDefault(); }
  }

  // ---------------------------------------------------------------- drawing (call every frame while visible)

  draw() {
    const wrap = this.$('.camWrap');
    const vw = this.video.videoWidth || 16, vh = this.video.videoHeight || 9;
    const aw = Math.max(50, wrap.clientWidth - 16), ah = Math.max(50, wrap.clientHeight - 16);
    let w = aw, h = aw * vh / vw;
    if (h > ah) { h = ah; w = ah * vw / vh; }
    w = Math.floor(w); h = Math.floor(h);
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.overlay]) {
      if (c.style.width !== w + 'px') { c.style.width = w + 'px'; c.style.height = h + 'px'; }
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (c.width !== pw) c.width = pw;
      if (c.height !== ph) c.height = ph;
    }
    const vctx = this.canvas.getContext('2d');
    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.ready) vctx.drawImage(this.video, 0, 0, w, h); else vctx.clearRect(0, 0, w, h);

    const ctx = this.overlay.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const o = this.hooks.currentOutput();
    const state = this.hooks.getState();
    const m = this.mode;
    const dot = (x, y, color, label) => {
      ctx.beginPath(); ctx.arc(x * w, y * h, 7, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
      if (label != null) { ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText(String(label), x * w + 10, y * h); }
    };
    if (m?.kind === 'manual') { m.pairs.forEach((p, i) => dot(p.cx, p.cy, '#ffe74c', i + 1)); this.hint(`Dots are numbered on the projector in reading order. Looking for dot ${m.i + 1}.`); return; }
    if (m?.kind === 'trace') {
      m.pts.forEach((p, i) => dot(p.x, p.y, '#ffe74c', ['TL', 'TR', 'BR', 'BL'][i]));
      if (m.pts.length > 1) { ctx.strokeStyle = '#ffe74c'; ctx.lineWidth = 1.5; ctx.beginPath(); m.pts.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h))); ctx.stroke(); }
      this.hint('');
      return;
    }
    const map = this.mapper(o);
    if (!o) { this.hint('Select a projector in the left column.'); return; }
    if (!map) { this.hint(`${o.name} is not calibrated yet. Point the camera at the projected area and press Calibrate (auto). Dim the room first.`); return; }
    // calibration dots
    for (const p of o.calib.pairs) { ctx.beginPath(); ctx.arc(p.cx * w, p.cy * h, 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(46,230,255,0.5)'; ctx.fill(); }
    // surfaces mapped into the camera image
    const sel = state.selection;
    for (const s of o.surfaces) {
      const isSel = sel.surfaceId === s.id;
      const ring = C.outline(C.evalMesh(s, 24)).map(p => map.projToCam(p.x, p.y));
      ctx.lineWidth = isSel ? 2 : 1.25;
      ctx.strokeStyle = isSel ? '#2ee6ff' : s.visible ? '#ffb020' : '#777';
      ctx.beginPath(); ring.forEach((p, i) => (i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h))); ctx.closePath(); ctx.stroke();
      for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
        const q = s.pts[r][c], cp = map.projToCam(q.x, q.y);
        const corner = (r === 0 || r === s.rows - 1) && (c === 0 || c === s.cols - 1);
        const ptSel = isSel && sel.point && sel.point.r === r && sel.point.c === c;
        dot(cp.x, cp.y, ptSel ? '#ffe74c' : corner ? (isSel ? '#2ee6ff' : '#ffb020') : '#ff6ad5');
      }
      const l = map.projToCam(s.pts[0][0].x, s.pts[0][0].y);
      ctx.fillStyle = isSel ? '#2ee6ff' : '#fff'; ctx.font = '12px system-ui'; ctx.textBaseline = 'bottom';
      ctx.fillText(s.name, l.x * w + 10, l.y * h - 8);
    }
    this.hint(`Calibrated (${o.calib.found}/${o.calib.total} dots). Drag handles on the camera image, or Trace object to add a surface where you click.`);
  }
  hint(t) { const el = this.$('.camHint'); if (el.textContent !== t) el.textContent = t; }
}
