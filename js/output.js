// output.js — one projector window. Renders its output from the state the control window broadcasts.
import * as C from './core.js';
import { Renderer, drawOverlay } from './render.js';
import { MediaProvider } from './media.js';
import { Editor } from './editor.js';

const id = new URLSearchParams(location.search).get('id');
const bc = new BroadcastChannel(C.CHANNEL);
const glCanvas = document.getElementById('gl');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');

let state = null;
let renderer = null;
let media = null;
let lastStateAt = 0;

try {
  renderer = new Renderer(glCanvas);
  media = new MediaProvider(renderer.gl, { audio: false });
} catch (e) {
  hud.textContent = e.message;
}

const output = () => (state ? C.findOutput(state, id) : null);

function send(op) {
  if (state) C.applyOp(state, op);
  bc.postMessage({ type: 'op', outputId: id, op });
}

new Editor(overlay, { get: () => ({ state: state || C.defaultState(), output: output() }), send });

bc.onmessage = ({ data: msg }) => {
  if (msg.type === 'state') {
    state = msg.state;
    lastStateAt = Date.now();
    if (media) media.sync(state);
  }
};
bc.postMessage({ type: 'hello', outputId: id });

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * dpr), h = Math.round(window.innerHeight * dpr);
  for (const c of [glCanvas, overlay]) { if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; }
  sendStatus();
}
function sendStatus() {
  bc.postMessage({ type: 'status', outputId: id, width: glCanvas.width, height: glCanvas.height, fullscreen: !!document.fullscreenElement });
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
  if (e.key === 'f' || e.key === 'F') { toggleFullscreen(); e.preventDefault(); }
  else if ((e.key === 'e' || e.key === 'E') && o) send({ type: 'toggle', outputId: o.id, key: 'editOverlay' });
  else if ((e.key === 't' || e.key === 'T') && o) send({ type: 'toggle', outputId: o.id, key: 'testPattern' });
});
overlay.addEventListener('dblclick', toggleFullscreen);

async function keepAwake() {
  try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch { /* not granted */ }
}
keepAwake();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

function frame() {
  const o = output();
  const dpr = window.devicePixelRatio || 1;
  const ctx = overlay.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = overlay.width / dpr, H = overlay.height / dpr;
  if (!state) {
    ctx.clearRect(0, 0, W, H);
    hud.textContent = 'Waiting for the control window… (open index.html in the same browser)';
    hud.style.display = '';
    if (Date.now() - lastStateAt > 1500) { bc.postMessage({ type: 'hello', outputId: id }); lastStateAt = Date.now(); }
  } else if (!o) {
    ctx.clearRect(0, 0, W, H);
    hud.textContent = 'This projector was removed from the show. You can close this window.';
    hud.style.display = '';
  } else {
    media.tick(state.transport);
    renderer.render(o, state, media);
    drawOverlay(ctx, o, state, W, H, { density: state.meshDensity, handles: o.editOverlay });
    document.title = o.name;
    if (o.editOverlay) {
      hud.style.display = '';
      hud.textContent = `${o.name} · ${glCanvas.width}×${glCanvas.height}` + (document.fullscreenElement ? '' : ' · F or double-click = fullscreen') + ' · E = hide handles · T = test pattern · drag points, arrows nudge';
    } else {
      hud.style.display = 'none';
    }
    document.body.classList.toggle('nocursor', !o.editOverlay);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
