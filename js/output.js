// output.js — a projector window. Renders one output (?id=…) or several side by side in one window
// (?ids=a,b,c or ?ids=all), from the state the control window broadcasts.
// A spanned window has one WebGL context and decodes each video once, however many projectors it feeds;
// stretch it across the displays (arranged side by side in the OS, in the same order as the ids).
import * as C from './core.js';
import { Renderer, drawOverlay } from './render.js';
import { MediaProvider } from './media.js';
import { Editor } from './editor.js';

const params = new URLSearchParams(location.search);
const singleId = params.get('id');
const spanIds = params.get('ids');                       // 'all' or a comma list; null = single-output window
const spanned = !!spanIds;
const bc = new BroadcastChannel(C.CHANNEL);
const glCanvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');

let state = null;
let renderer = null;
let media = null;
let lastStateAt = 0;
const calibs = new Map(); // outputId -> {mode:'black'|'marker'|'markers', markers:[{x,y,n}]} while the control window calibrates a camera
let active = 0;           // index of the output under the pointer (spanned window): keys and edits go to it

try {
  renderer = new Renderer(glCanvas);
  media = new MediaProvider(renderer.gl, { audio: false, under: document.body });
} catch (e) {
  hud.textContent = e.message;
}

// The outputs this window shows, in left-to-right order.
function outputs() {
  if (!state) return [];
  if (!spanned) { const o = C.findOutput(state, singleId); return o ? [o] : []; }
  if (spanIds === 'all') return state.outputs;
  return spanIds.split(',').map(id => C.findOutput(state, id)).filter(Boolean);
}
// Each output's rectangle in canvas pixels (y down) and CSS pixels. Widths share the window in proportion
// to the outputs' pixel widths; all get the full height (spanned displays sit side by side).
function layout() {
  const list = outputs();
  const dpr = window.devicePixelRatio || 1;
  const CW = glCanvas.width, CH = glCanvas.height;
  const total = list.reduce((a, o) => a + o.width, 0) || 1;
  let x = 0;
  return list.map(o => {
    const w = spanned ? Math.round(CW * o.width / total) : CW;
    const rect = { x, y: 0, w, h: CH };
    const css = { x: x / dpr, y: 0, w: w / dpr, h: CH / dpr };
    x += w;
    return { o, rect, css };
  });
}
const activeTarget = () => { const L = layout(); return L[Math.min(active, L.length - 1)] || null; };
const output = () => activeTarget()?.o || null;
const usedHere = () => { const ids = new Set(); for (const o of outputs()) for (const m of C.usedMedia(state, o)) ids.add(m); return mid => ids.has(mid); };
let fpsCount = 0, fpsAt = performance.now(), fps = 0;

function send(op) {
  if (state) C.applyOp(state, op);
  bc.postMessage({ type: 'op', outputId: output()?.id, op });
}

const editor = new Editor(overlay, {
  get: () => ({ state: state || C.defaultState(), output: output() }),
  region: () => activeTarget()?.css || null,
  flip: () => flipOf(output()),
  send,
});
// How this output's picture is flipped in software (see output.flip); the overlay and pointer follow it.
function flipOf(o) { const fl = o?.flip || 'none'; return { x: fl.startsWith('mirror'), y: fl.endsWith('rot180') }; }
// Which output the pointer is over (not while dragging: a drag stays with the output it started in).
overlay.addEventListener('pointermove', e => {
  if (!spanned || editor.drag) return;
  const r = overlay.getBoundingClientRect();
  const x = e.clientX - r.left;
  const L = layout();
  const i = L.findIndex(t => x >= t.css.x && x < t.css.x + t.css.w);
  if (i >= 0) active = i;
}, true);

bc.onmessage = ({ data: msg }) => {
  if (msg.type === 'state') {
    state = msg.state;
    lastStateAt = Date.now();
    if (media) media.sync(state, usedHere());
  } else if (msg.type === 'calib') {
    if (msg.mode === 'off') calibs.delete(msg.outputId); else calibs.set(msg.outputId, msg);
  }
};
function hello() { bc.postMessage({ type: 'hello', outputId: singleId, spanned }); }
hello();

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
  for (const c of [glCanvas, overlay]) { if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; }
  sendStatus();
}
function sendStatus() {
  if (!state) return;
  for (const t of layout()) {
    bc.postMessage({ type: 'status', outputId: t.o.id, width: t.rect.w, height: t.rect.h, fullscreen: !!document.fullscreenElement, spanned, windowWidth: glCanvas.width, windowHeight: glCanvas.height });
  }
}
window.addEventListener('resize', resize);
document.addEventListener('fullscreenchange', resize);
setInterval(sendStatus, 1000);
resize();

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}
document.addEventListener('keydown', e => {
  const o = output();
  if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { bc.postMessage({ type: e.shiftKey ? 'redo' : 'undo' }); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { bc.postMessage({ type: 'redo' }); e.preventDefault(); return; }
  if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); e.preventDefault(); }
  else if ((e.key === 'e' || e.key === 'E') && o) send({ type: 'toggle', outputId: o.id, key: 'editOverlay' });
  else if (e.key === 'd' || e.key === 'D') { diag.show = !diag.show; if (!diag.show) hud.style.display = 'none'; }
  else if ((e.key === 't' || e.key === 'T') && o) send({ type: 'toggle', outputId: o.id, key: 'testPattern' });
});
overlay.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('pointerup', () => bc.postMessage({ type: 'gestureEnd' }));
document.addEventListener('keyup', e => { if (e.key.startsWith('Arrow')) bc.postMessage({ type: 'gestureEnd' }); });

async function keepAwake() {
  try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch { /* not granted */ }
}
keepAwake();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

const diag = { errors: 0, lastError: '', frames: 0, show: false };
function frame() {
  try { frameBody(); } catch (e) { diag.errors++; diag.lastError = (e && e.message) || String(e); hud.style.display = ''; hud.textContent = `Error in frame loop (${diag.errors}): ${diag.lastError}`; }
  if (renderer && renderer.lost && !diag.reloading) { diag.reloading = true; setTimeout(() => location.reload(), 2000); }
  requestAnimationFrame(frame);
}

function drawCalib(ctx, t, calib) {
  const { x, y, w, h } = t.css;
  if (calib.mode === 'black') return;
  const rad = Math.max(6, Math.min(w, h) * 0.03);
  for (const m of calib.markers) {
    ctx.beginPath(); ctx.arc(x + m.x * w, y + m.y * h, rad, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    if (calib.mode === 'markers') { ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(rad * 1.6)}px system-ui`; ctx.textBaseline = 'middle'; ctx.fillText(String(m.n), x + m.x * w + rad * 1.4, y + m.y * h); }
  }
}

function frameBody() {
  diag.frames++;
  const dpr = window.devicePixelRatio || 1;
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = overlay.width / dpr, H = overlay.height / dpr;
  const targets = layout();
  if (!state) {
    ctx.clearRect(0, 0, W, H);
    hud.textContent = 'Waiting for the control window… (open index.html in the same browser)';
    hud.style.display = '';
    if (Date.now() - lastStateAt > 1500) { hello(); lastStateAt = Date.now(); }
    return;
  }
  if (!targets.length) {
    ctx.clearRect(0, 0, W, H);
    hud.textContent = spanned ? 'None of these projectors exist in the show. You can close this window.' : 'This projector was removed from the show. You can close this window.';
    hud.style.display = '';
    return;
  }
  const calibrating = targets.filter(t => calibs.has(t.o.id));
  if (calibrating.length) {
    // Camera calibration: everything black except the dots of the output being calibrated.
    const gl = renderer.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    for (const t of calibrating) drawCalib(ctx, t, calibs.get(t.o.id));
    hud.style.display = 'none';
    return;
  }
  if (++fpsCount >= 30) { const now = performance.now(); fps = Math.round(fpsCount * 1000 / (now - fpsAt)); fpsCount = 0; fpsAt = now; }
  media.uploadVia = state.videoPath === 'canvas' ? 'canvas' : 'direct';
  media.tick(state.transport);
  ctx.clearRect(0, 0, W, H);
  for (const t of targets) {
    renderer.render(t.o, state, media, spanned ? t.rect : null);
    ctx.save();
    ctx.translate(t.css.x, t.css.y);
    ctx.beginPath(); ctx.rect(0, 0, t.css.w, t.css.h); ctx.clip();
    const fl = flipOf(t.o);
    if (fl.x || fl.y) { ctx.translate(fl.x ? t.css.w : 0, fl.y ? t.css.h : 0); ctx.scale(fl.x ? -1 : 1, fl.y ? -1 : 1); }
    drawOverlay(ctx, t.o, state, t.css.w, t.css.h, { density: state.meshDensity, handles: t.o.editOverlay });
    if (spanned && t.o.editOverlay) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, t.css.w - 1, t.css.h - 1);
    }
    ctx.restore();
  }
  document.title = targets.map(t => t.o.name).join(' + ');
  const o = output();
  const anyHandles = targets.some(t => t.o.editOverlay);
  if (diag.show) {
    hud.style.display = '';
    const lines = [`PROJECTOR${spanned ? ' (spanned ×' + targets.length + ')' : ''} frames=${diag.frames} fps=${fps} errors=${diag.errors}${diag.lastError ? ' last=' + diag.lastError : ''} glLost=${renderer.lost} window=${glCanvas.width}x${glCanvas.height}`,
      `transport playing=${state.transport.playing} clock=${C.transportTime(state.transport).toFixed(2)} videoPath=${state.videoPath || 'direct'} stateAge=${((Date.now() - lastStateAt) / 1000).toFixed(1)}s`];
    for (const t of targets) lines.push(`${t.o.name} ${t.rect.w}x${t.rect.h}: ${t.o.surfaces.map(s => `${s.name}[${s.visible ? 'on' : 'off'},${s.fill}]`).join(' ')}`);
    lines.push(...media.lines(state.transport));
    hud.textContent = lines.join('\n');
    hud.style.whiteSpace = 'pre-wrap';
  } else if (anyHandles) {
    hud.style.display = '';
    const stq = media.stats();
    const need = targets.reduce((a, t) => a + t.o.width, 0);
    const sizeNote = spanned && glCanvas.width !== need ? ` · window is ${glCanvas.width}×${glCanvas.height}, projectors want ${need}×${Math.max(...targets.map(t => t.o.height))}: stretch it across the displays` : '';
    hud.textContent = `${targets.map(t => t.o.name).join(' + ')} · ${glCanvas.width}×${glCanvas.height} · ${fps} fps · ${stq.videos} video${stq.videos === 1 ? '' : 's'}${stq.dropped ? ` · ${stq.dropped} dropped` : ''}${sizeNote}`
      + (spanned ? (o ? ` · editing ${o.name}` : '') : (document.fullscreenElement ? '' : ' · F or double-click = fullscreen'))
      + ' · E = hide handles · T = test pattern · drag points, arrows nudge';
  } else {
    hud.style.display = 'none';
  }
  document.body.classList.toggle('nocursor', !anyHandles && !diag.show);
}
requestAnimationFrame(frame);
window.pmapOutput = { get state() { return state; }, get renderer() { return renderer; }, layout, frameBody };   // for test pages and the console
