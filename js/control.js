// control.js — the control window: media bin, outputs, inspector, preview, transport.
import * as C from './core.js';
import { Renderer, drawOverlay } from './render.js';
import { MediaProvider } from './media.js';
import { Editor } from './editor.js';
import { CameraPanel } from './camera.js';
import { silhouettePng, guideSvg, download } from './export.js';

const $ = s => document.querySelector(s);
const bc = new BroadcastChannel(C.CHANNEL);
const outputStatus = new Map();   // outputId -> {width,height,fullscreen,lastSeen}
const outputWindows = new Map();  // outputId -> Window
const mediaInfo = new Map();      // mediaId -> {duration,width,height,error}
let screens = null;               // Chrome/Edge Window Management API, when granted

let state = loadState();
let previewMedia = true;    // untick to show poster frames instead (this window then decodes nothing)

// ---------------------------------------------------------------- persistence + sync

function normalize(raw) {
  const d = C.defaultState();
  const s = Object.assign(d, raw);
  s.transport = Object.assign(C.defaultState().transport, raw.transport || {}, { playing: false, pausedAt: 0 });
  s.selection = Object.assign(C.defaultState().selection, raw.selection || {});
  for (const m of s.media) if (!m.persistent) m.missing = true; // blob: URLs die with the page
  for (const o of s.outputs) { C.upgradeOutput(o); for (const sf of o.surfaces) C.upgradeSurface(sf); }
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(C.STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : C.defaultState();
  } catch { return C.defaultState(); }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem(C.STORAGE_KEY, JSON.stringify(state)), 250);
}

let bcTimer = null;
function broadcast() {
  if (bcTimer) return;
  bcTimer = setTimeout(() => { bcTimer = null; bc.postMessage({ type: 'state', state }); }, 8);
}

// ---------------------------------------------------------------- undo / redo
// Snapshot-based. `lastCommitted` is the state as of the previous commit; a commit
// pushes it onto the undo stack unless it continues the same gesture (same key,
// within 1.5 s), so a drag or a slider sweep is one step.
const history = { undo: [], redo: [], lastKey: null, lastAt: 0, max: 100 };
let lastCommitted = JSON.stringify(state);
let activeKey = null;   // set by slider/editor helpers while a gesture is in progress

function commit(rebuild = false, opts = {}) {
  const { history: track = true, key = activeKey } = opts;
  if (track) {
    const now = Date.now();
    const sameGesture = key && key === history.lastKey && now - history.lastAt < 1500;
    if (!sameGesture) {
      history.undo.push(lastCommitted);
      if (history.undo.length > history.max) history.undo.shift();
      history.redo.length = 0;
    }
    history.lastKey = key || null;
    history.lastAt = now;
  }
  lastCommitted = JSON.stringify(state);
  save();
  broadcast();
  probeMedia();
  if (rebuild) { rebuildLists(); rebuildInspector(); }
  updateUndoButtons();
}

function restore(snapshot) {
  logT('undo/redo restore');
  const next = JSON.parse(snapshot);
  next.transport = state.transport;  // playback is not part of the edit history
  state = next;
  history.lastKey = null;
  commit(true, { history: false });
}
function undo() {
  if (!history.undo.length) return;
  history.redo.push(JSON.stringify(state));
  restore(history.undo.pop());
  toast('Undo', 1200);
}
function redo() {
  if (!history.redo.length) return;
  history.undo.push(JSON.stringify(state));
  restore(history.redo.pop());
  toast('Redo', 1200);
}
function endGesture() { history.lastKey = null; activeKey = null; }
function updateUndoButtons() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (u) u.disabled = !history.undo.length;
  if (r) r.disabled = !history.redo.length;
}
const opKey = op => `${op.type}:${op.surfaceId || op.outputId || ''}:${op.r ?? ''},${op.c ?? ''}:${op.i ?? ''}`;
const VIEW_OPS = ['select', 'toggle'];

// More than one control window open = two sources of truth fighting over the show. Detect and warn.
const controlId = C.uid();
bc.postMessage({ type: 'control-hello', controlId });
let otherControlSeen = 0;
function warnOtherControl() {
  otherControlSeen = Date.now();
  toast('ANOTHER CONTROL WINDOW IS OPEN. Close the other one (or this one) — two control windows fight over the show and playback stops.', 15000);
}

bc.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'control-hello':
      if (msg.controlId !== controlId) { bc.postMessage({ type: 'control-here', controlId }); warnOtherControl(); }
      break;
    case 'control-here':
      if (msg.controlId !== controlId) warnOtherControl();
      break;
    case 'hello':
      bc.postMessage({ type: 'state', state });
      break;
    case 'op':
      if (C.applyOp(state, msg.op)) commit(['select', 'toggle', 'cycleFill', 'addMaskPoint', 'removeMaskPoint'].includes(msg.op.type), { history: !VIEW_OPS.includes(msg.op.type), key: opKey(msg.op) });
      break;
    case 'gestureEnd':
      endGesture();
      break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'status': {
      outputStatus.set(msg.outputId, { ...msg, lastSeen: Date.now() });
      const o = C.findOutput(state, msg.outputId);
      if (o && msg.width >= 64 && msg.height >= 64 && (o.width !== msg.width || o.height !== msg.height)) {
        o.width = msg.width; o.height = msg.height;
        commit(false, { history: false });
        updateStatusTexts();
      }
      updateStatusTexts();
      break;
    }
  }
};

// ---------------------------------------------------------------- tiny DOM helpers

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}
const btn = (text, onclick, cls = '') => el('button', { class: cls, type: 'button', onclick }, text);
const field = (label, ...inputs) => el('label', { class: 'field' }, el('span', { text: label }), ...inputs);

function textInput(value, onchange) {
  const i = el('input', { type: 'text', value });
  i.addEventListener('change', () => onchange(i.value.trim() || value));
  return i;
}
function numInput(value, min, max, step, onchange) {
  const i = el('input', { type: 'number', value, min, max, step });
  if (onchange) i.addEventListener('change', () => onchange(C.clamp(parseFloat(i.value) || 0, min, max)));
  return i;
}
function checkInput(label, value, onchange) {
  const i = el('input', { type: 'checkbox' });
  i.checked = !!value;
  i.addEventListener('change', () => onchange(i.checked));
  return el('label', { class: 'check' }, i, el('span', { text: label }));
}
function selectInput(value, options, onchange) {
  const s = el('select');
  for (const o of options) s.append(el('option', { value: o.value, text: o.label }));
  s.value = value;
  s.addEventListener('change', () => onchange(s.value));
  return s;
}
function slider(label, value, min, max, step, oninput, fmt = v => String(v)) {
  const out = el('output', { text: fmt(value) });
  const i = el('input', { type: 'range', min, max, step, value });
  const key = 'slider:' + label + ':' + (state.selection.surfaceId || state.selection.outputId || '');
  i.addEventListener('input', () => { const v = parseFloat(i.value); out.textContent = fmt(v); activeKey = key; oninput(v); activeKey = null; });
  i.addEventListener('change', endGesture);
  i.addEventListener('dblclick', () => { i.value = value; i.dispatchEvent(new Event('input')); });
  return el('label', { class: 'field slider' }, el('span', { text: label }), i, out);
}

let toastTimer = null;
function toast(msg, ms = 4000) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const fmtTime = s => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};

// ---------------------------------------------------------------- media

function addMediaFiles(files) {
  let n = 0;
  for (const f of files) {
    const kind = C.kindFromName(f.name) || (f.type.startsWith('video') ? 'video' : f.type.startsWith('image') ? 'image' : f.type.startsWith('audio') ? 'audio' : null);
    if (!kind) continue;
    const url = URL.createObjectURL(f);
    const existing = state.media.find(m => m.name === f.name && m.missing);
    if (existing) { existing.url = url; existing.missing = false; probed.delete(existing.id); mediaInfo.delete(existing.id); }
    else state.media.push({ id: C.uid(), name: f.name, url, kind, persistent: false });
    n++;
  }
  toast(`${n} file(s) added (this session only — put files in media/ to keep them)`);
  commit(true);
}

async function scanFolder() {
  try {
    const res = await fetch('media/', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    let added = 0;
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href || href.endsWith('/') || href.startsWith('?') || href.startsWith('/') || href.includes('://')) continue;
      const name = decodeURIComponent(href);
      const kind = C.kindFromName(name);
      if (!kind) continue;
      const url = 'media/' + href;
      if (state.media.some(m => m.url === url)) continue;
      // A file added earlier with "Add files…" (session-only) that now lives in media/: relink it, keep its surfaces.
      const stale = state.media.find(m => m.name === name && m.url !== url && (m.missing || !m.persistent));
      if (stale) { stale.url = url; stale.persistent = true; stale.missing = false; probed.delete(stale.id); mediaInfo.delete(stale.id); added++; continue; }
      state.media.push({ id: C.uid(), name, url, kind, persistent: true });
      added++;
    }
    toast(added ? `${added} file(s) added from media/` : 'No new files in media/');
    commit(true);
  } catch {
    toast('Could not read media/ — start serve.ps1 and open http://127.0.0.1:8765/');
  }
}

function removeMedia(m) {
  state.media = state.media.filter(x => x !== m);
  for (const o of state.outputs) for (const s of o.surfaces) if (s.mediaId === m.id) s.mediaId = null;
  if (!m.persistent && m.url.startsWith('blob:')) URL.revokeObjectURL(m.url);
  commit(true);
}

// ---------------------------------------------------------------- outputs

function currentOutput() {
  return C.findOutput(state, state.selection.outputId) || state.outputs[0] || null;
}

function addOutput() {
  const o = C.makeOutput(state.outputs.length + 1);
  state.outputs.push(o);
  state.selection = { outputId: o.id, surfaceId: null, point: null };
  commit(true);
}

function removeOutput(o) {
  if (!confirm(`Delete ${o.name} and its ${o.surfaces.length} surface(s)?`)) return;
  const w = outputWindows.get(o.id);
  if (w && !w.closed) w.close();
  state.outputs = state.outputs.filter(x => x !== o);
  state.selection = { outputId: state.outputs[0]?.id ?? null, surfaceId: null, point: null };
  commit(true);
}

function addSurface(o) {
  const s = C.makeSurface(o.surfaces.length + 1, state.media.find(m => !m.missing && m.kind !== 'audio')?.id ?? null);
  o.surfaces.push(s);
  state.selection = { outputId: o.id, surfaceId: s.id, point: null };
  commit(true);
}

function openOutput(o, screen = null) {
  const existing = outputWindows.get(o.id);
  if (existing && !existing.closed) { existing.focus(); return; }
  let feat = 'popup=yes,width=1280,height=720';
  if (screen) feat = `popup=yes,left=${screen.left},top=${screen.top},width=${screen.availWidth},height=${screen.availHeight}`;
  const w = window.open(`output.html?id=${encodeURIComponent(o.id)}`, `pmap-out-${o.id}`, feat);
  if (!w) { toast('Popup blocked — allow popups for this site, then try again'); return; }
  outputWindows.set(o.id, w);
}

async function detectScreens() {
  if (!('getScreenDetails' in window)) {
    toast('Display placement needs Chrome or Edge. In Firefox, drag the projector window onto the projector and press F.');
    return;
  }
  try {
    const d = await window.getScreenDetails();
    screens = d.screens;
    d.addEventListener('screenschange', () => { screens = d.screens; rebuildInspector(); });
    rebuildInspector();
  } catch {
    toast('Display access was not granted.');
  }
}

// ---------------------------------------------------------------- lists (left column)

function isConnected(o) {
  const st = outputStatus.get(o.id);
  return !!st && Date.now() - st.lastSeen < 3000;
}

function rebuildLists() {
  const ml = $('#mediaList');
  ml.replaceChildren();
  if (!state.media.length) ml.append(el('div', { class: 'emptyRow', text: 'No media yet.' }));
  for (const m of state.media) {
    const info = mediaInfo.get(m.id);
    let meta = m.kind;
    if (info?.error) meta = 'cannot load';
    else if (info) meta = m.kind === 'audio' ? `audio · ${fmtTime(info.duration)}` : info.duration ? `${info.width}×${info.height} · ${fmtTime(info.duration)}` : `${info.width}×${info.height}`;
    if (m.missing) meta = 'missing — Add files… to relink';
    ml.append(el('div', { class: 'item' + (m.missing || info?.error ? ' warn' : '') },
      el('div', { class: 'grow' }, el('div', { class: 'title', text: m.name }), el('div', { class: 'meta', text: meta })),
      btn('×', () => removeMedia(m), 'icon')));
  }

  const ol = $('#outputList');
  ol.replaceChildren();
  if (!state.outputs.length) ol.append(el('div', { class: 'emptyRow', text: 'No projectors yet.' }));
  const sel = state.selection;
  const cur = currentOutput();
  for (const o of state.outputs) {
    const row = el('div', { class: 'item output' + (cur === o && !sel.surfaceId ? ' selected' : ''),
      onclick: () => { state.selection = { outputId: o.id, surfaceId: null, point: null }; commit(true); } },
      el('span', { class: 'dot' + (isConnected(o) ? ' on' : ''), title: isConnected(o) ? 'Window open' : 'Window not open' }),
      el('div', { class: 'grow' }, el('div', { class: 'title', text: o.name }), el('div', { class: 'meta', text: `${o.width}×${o.height} · ${o.surfaces.length} surface(s)` })),
      btn('Open', e => { e.stopPropagation(); openOutput(o); }, 'small'));
    ol.append(row);
    for (const s of o.surfaces) {
      ol.append(el('div', { class: 'item surface' + (sel.surfaceId === s.id ? ' selected' : '') + (s.visible ? '' : ' hidden'),
        onclick: () => { state.selection = { outputId: o.id, surfaceId: s.id, point: null }; commit(true); } },
        el('div', { class: 'grow' }, el('div', { class: 'title', text: s.name }),
          el('div', { class: 'meta', text: `${s.cols}×${s.rows} · ` + (s.fill === 'grid' ? 'grid' : s.fill === 'color' ? `solid ${s.color}` : (state.media.find(m => m.id === s.mediaId)?.name ?? 'no source')) }))));
    }
  }
  $('#showName').value = state.name;
  $('#previewEmpty').style.display = state.outputs.length ? 'none' : '';
}

function updateStatusTexts() {
  document.querySelectorAll('[data-status-for]').forEach(n => {
    const o = C.findOutput(state, n.dataset.statusFor);
    if (o) n.textContent = statusText(o);
  });
  document.querySelectorAll('#outputList .dot').forEach((d, i) => {
    const o = state.outputs[i];
    if (o) d.classList.toggle('on', isConnected(o));
  });
}

function statusText(o) {
  const st = outputStatus.get(o.id);
  if (!isConnected(o)) return 'Projector window: not open';
  if (st.spanned) return `Spanned window: this projector gets ${st.width}×${st.height} of ${st.windowWidth}×${st.windowHeight}`;
  return `Projector window: ${st.width}×${st.height}${st.fullscreen ? ' · fullscreen' : ' · windowed (press F in it)'}`;
}

// One window for every projector: one WebGL context and one decode per video instead of one per window.
// Stretch it across the displays (arranged side by side in the OS, in the show's projector order).
let spanWindow = null;
function openSpanned() {
  if (spanWindow && !spanWindow.closed) { spanWindow.focus(); return; }
  const w = state.outputs.reduce((a, o) => a + o.width, 0), h = Math.max(1, ...state.outputs.map(o => o.height));
  let feat = `popup=yes,width=${w},height=${h}`;
  if (screens && screens.length) feat += `,left=${Math.min(...screens.map(sc => sc.left))},top=${Math.min(...screens.map(sc => sc.top))}`;
  spanWindow = window.open('output.html?ids=all', 'pmap-out-span', feat);
  if (!spanWindow) { toast('Popup blocked — allow popups for this site, then try again'); return; }
  toast(`Spanned window wants ${w}×${h}: if the browser clamped it to one display, drag its edges across the others. Chrome's own fullscreen only covers one display.`, 9000);
}

// ---------------------------------------------------------------- inspector (right column)

function rebuildInspector() {
  const box = $('#inspector');
  box.replaceChildren();
  const o = currentOutput();
  const s = o && o.surfaces.find(x => x.id === state.selection.surfaceId);
  if (s) box.append(surfaceInspector(o, s));
  else if (o) box.append(outputInspector(o));
  box.append(settingsPanel(!!o));
  needFit = true;
}

function outputInspector(o) {
  const box = el('div', { class: 'panel' });
  box.append(el('h2', { text: 'Projector' }));
  box.append(field('Name', textInput(o.name, v => { o.name = v; commit(true); })));
  box.append(el('div', { class: 'status', 'data-status-for': o.id, text: statusText(o) }));
  box.append(el('div', { class: 'row' }, btn('Open projector window', () => openOutput(o), 'primary'), btn('Detect displays', detectScreens)));
  box.append(el('div', { class: 'status', text: o.calib ? `Camera: calibrated (${o.calib.found}/${o.calib.total} dots)` : 'Camera: not calibrated (Camera tab)' }));
  if (screens) {
    const row = el('div', { class: 'row wrap' });
    screens.forEach((sc, i) => row.append(btn(`Open on ${sc.label || 'display ' + (i + 1)} (${sc.width}×${sc.height})`, () => openOutput(o, sc), 'small')));
    box.append(row);
  }
  box.append(el('div', { class: 'row' },
    field('Width', numInput(o.width, 320, 8192, 1, v => { o.width = v; commit(true); })),
    field('Height', numInput(o.height, 240, 8192, 1, v => { o.height = v; commit(true); }))));
  box.append(el('p', { class: 'hint', text: 'Size follows the projector window once it is open. Set it by hand only for planning.' }));
  box.append(checkInput('Show handles on the projector (E)', o.editOverlay, v => { o.editOverlay = v; commit(); }));
  box.append(checkInput('Test pattern (T)', o.testPattern, v => { o.testPattern = v; commit(); }));
  box.append(slider('Brightness', o.brightness, 0, 1, 0.01, v => { o.brightness = v; commit(); }, v => v.toFixed(2)));
  box.append(slider('Gamma', o.gamma, 0.5, 3, 0.01, v => { o.gamma = v; commit(); }, v => v.toFixed(2)));

  box.append(el('h3', { text: 'Setup template' }));
  C.upgradeOutput(o);
  const tp = o.template;
  box.append(el('p', { class: 'hint', text: 'The real object at its real size, drawn on the projector as a dashed outline, so you can place and zoom the projector before the object is lit. Enter the lens throw ratio (distance ÷ image width; it is in the projector\'s spec sheet) and the distance.' }));
  box.append(checkInput('Show template on this projector', tp.enabled, v => { tp.enabled = v; commit(); }));
  box.append(field('Object', selectInput(tp.preset, C.TEMPLATE_PRESETS.map(p => ({ value: p.id, label: p.name })), v => {
    const p = C.TEMPLATE_PRESETS.find(x => x.id === v); tp.preset = v; tp.shape = p.shape; tp.widthIn = p.widthIn; tp.heightIn = p.heightIn; tp.name = v === 'custom' ? 'Object' : (v.startsWith('moon') ? 'Moon' : p.name); commit(true);
  })));
  box.append(field('Name', textInput(tp.name, v => { tp.name = v; commit(); })));
  box.append(el('div', { class: 'row' },
    field('Width (in)', numInput(tp.widthIn, 1, 600, 0.5, v => { tp.widthIn = v; if (tp.shape === 'circle') tp.heightIn = v; commit(true); })),
    field('Height (in)', numInput(tp.heightIn, 1, 600, 0.5, v => { tp.heightIn = v; if (tp.shape === 'circle') tp.widthIn = v; commit(true); })),
    field('Shape', selectInput(tp.shape, [{ value: 'circle', label: 'Circle / sphere' }, { value: 'rect', label: 'Rectangle' }], v => { tp.shape = v; commit(true); }))));
  box.append(el('div', { class: 'row' },
    field('Throw ratio', numInput(tp.throwRatio, 0.2, 5, 0.01, v => { tp.throwRatio = v; commit(true); })),
    field('Distance (ft)', numInput(tp.distanceFt, 1, 200, 0.1, v => { tp.distanceFt = v; commit(true); })),
    field('Lens offset', numInput(tp.lensOffset ?? 1, -1, 2, 0.05, v => { tp.lensOffset = v; commit(true); }))));
  box.append(el('p', { class: 'hint', text: 'Lens offset is in the spec sheet: 1.0 (or "100%") means the bottom edge of the picture is level with the lens, 0 means the picture is centred on the lens, 0.5 is halfway.' }));
  box.append(el('div', { class: 'row' },
    field('Mounting', selectInput(o.mount || 'table', [{ value: 'table', label: 'Table / upright' }, { value: 'ceiling', label: 'Ceiling (hangs upside down)' }], v => { o.mount = v; commit(true); })),
    field('Flip picture in software', selectInput(o.flip || 'none', [{ value: 'none', label: 'No (projector menu does it)' }, { value: 'rot180', label: 'Upside down (180°)' }, { value: 'mirror', label: 'Mirror (rear projection)' }, { value: 'mirror-rot180', label: 'Mirror + upside down' }], v => { o.flip = v; commit(true); }))));
  box.append(el('p', { class: 'hint', text: 'A ceiling-mounted projector throws its lens offset downward, which changes where the ball sits and the mounting height below; set Mounting even if the projector\'s own Ceiling setting already turns the picture the right way up. Flip in software only when the projector has no Ceiling/Rear setting (the Windows display Orientation "Landscape (flipped)" also works).' }));
  const tm = C.templateMetrics(o);
  const lensLine = tm.lensBelowObjectIn >= 0 ? `Mount the lens ${tm.lensBelowObjectIn.toFixed(0)} in below the ${tp.name.toLowerCase()}'s centre` : `Mount the lens ${(-tm.lensBelowObjectIn).toFixed(0)} in above the ${tp.name.toLowerCase()}'s centre`;
  box.append(el('p', { class: 'hint', text: `At ${tp.distanceFt} ft the image is ${tm.frameWidthIn.toFixed(0)} × ${tm.frameHeightIn.toFixed(0)} in (${tm.ppi.toFixed(1)} px per inch). The ${tp.name.toLowerCase()} spans ${Math.round(tm.wPx)} × ${Math.round(tm.hPx)} px, ${Math.round(tm.fraction * 100)}% of the width and ${Math.round(tm.hPx / o.height * 100)}% of the height. ${lensLine}, square to the object, for it to land on the outline.` }));
  box.append(el('div', { class: 'row wrap' },
    btn('Distance to fill 70%', () => { tp.distanceFt = Math.round(C.templateDistanceFor(o, 0.7) * 10) / 10; commit(true); }),
    btn('Distance to fill 90%', () => { tp.distanceFt = Math.round(C.templateDistanceFor(o, 0.9) * 10) / 10; commit(true); })));
  box.append(el('p', { class: 'hint', text: 'Fill is measured on whichever side of the frame the object hits first: a sphere on a 16:9 projector is limited by the height.' }));
  box.append(slider('Position X', tp.cx, 0, 1, 0.001, v => { tp.cx = v; commit(); }, v => v.toFixed(3)));
  box.append(slider('Position Y', tp.cy, 0, 1, 0.001, v => { tp.cy = v; commit(); }, v => v.toFixed(3)));
  box.append(el('div', { class: 'row wrap' },
    btn('Make surface from template', () => { C.applyOp(state, { type: 'surfaceFromTemplate', outputId: o.id }); commit(true); }, 'primary'),
    btn('Make 360° ball surface', () => { C.applyOp(state, { type: 'surfaceFromTemplate', outputId: o.id, kind: 'sphere' }); commit(true); })));
  box.append(el('p', { class: 'hint', text: 'Once the real object sits inside the outline, this creates a surface on it (with a circular mask for a sphere) that you can fine-tune like any other. The 360° ball surface instead wraps a 2:1 panoramic strip round the ball, so several projectors round it can share one video (see the surface\'s Type).' }));

  box.append(el('h3', { text: 'Brightness ramp' }));
  box.append(el('p', { class: 'hint', text: 'Gain at each edge, blended across the frame. Raise the edge that is farthest from the projector (usually the top) to even out the picture. Above 1 can clip bright content.' }));
  if (!o.ramp) o.ramp = { top: 1, bottom: 1, left: 1, right: 1 };
  for (const [k, label] of [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']]) {
    box.append(slider(`${label} gain`, o.ramp[k], 0.5, 2.5, 0.01, v => { o.ramp[k] = v; commit(); }, v => `×${v.toFixed(2)}`));
  }

  box.append(el('h3', { text: 'Edge blend' }));
  box.append(el('p', { class: 'hint', text: 'Where two projectors overlap, feather the overlapping edge on both. Width in output pixels.' }));
  for (const [k, label] of [['left', 'Left'], ['right', 'Right'], ['top', 'Top'], ['bottom', 'Bottom']]) {
    const e = o.blend[k];
    box.append(slider(`${label} width`, e.w, 0, Math.round(Math.max(o.width, o.height) / 2), 1, v => { e.w = v; commit(); }, v => `${v}px`));
    box.append(slider(`${label} curve`, e.g, 1, 4, 0.05, v => { e.g = v; commit(); }, v => v.toFixed(2)));
  }

  box.append(el('h3', { text: 'Content template' }));
  box.append(el('p', { class: 'hint', text: `Downloads the exact shape this projector lights, at ${o.width}×${o.height}. Make your video at that size, then show it on a Full frame surface.` + (isConnected(o) ? '' : ' Open the projector window first so the size is the real one.') }));
  const safe = () => (o.name || 'projector').replace(/[^\w.-]+/g, '_');
  box.append(el('div', { class: 'row wrap' },
    btn('Shape PNG', async () => { try { download(await silhouettePng(o, state), `${safe()}_${o.width}x${o.height}_shape.png`); } catch (e) { toast('Export failed: ' + e.message); } }),
    btn('Guide SVG', () => { try { download(new Blob([guideSvg(o, state)], { type: 'image/svg+xml' }), `${safe()}_${o.width}x${o.height}_guide.svg`); } catch (e) { toast('Export failed: ' + e.message); } })));
  box.append(el('p', { class: 'hint', text: 'Shape PNG = white on black, pixel-exact: use it as a track matte or mask layer. Guide SVG = outlines, warp grid lines and point numbers as vectors: lay it over your composition.' }));

  box.append(el('h3', { text: 'Surfaces' }));
  box.append(el('div', { class: 'row' }, btn('Add surface', () => addSurface(o), 'primary')));
  box.append(el('p', { class: 'hint', text: 'A surface is one patch of video. Flat wall or screen: keep the 2×2 grid and drag the corners. Curved: raise the grid and pull the inner points.' }));
  box.append(el('div', { class: 'row end' }, btn('Delete projector', () => removeOutput(o), 'danger')));
  return box;
}

function surfaceInspector(o, s) {
  const box = el('div', { class: 'panel' });
  box.append(el('h2', { text: 'Surface' }), el('div', { class: 'crumb', text: o.name }));
  box.append(field('Name', textInput(s.name, v => { s.name = v; commit(true); })));
  box.append(field('Source', selectInput(s.mediaId ?? '',
    [{ value: '', label: '(none — checkerboard)' }, ...state.media.filter(m => m.kind !== 'audio').map(m => ({ value: m.id, label: m.name + (m.missing ? ' (missing)' : '') }))],
    v => { s.mediaId = v || null; commit(true); })));
  box.append(field('Show', selectInput(s.fill,
    [{ value: 'source', label: 'Source' }, { value: 'grid', label: 'Grid (for lining up)' }, { value: 'color', label: 'Solid color' }],
    v => { s.fill = v; commit(true); })));
  if (s.fill !== 'source') {
    const col = el('input', { type: 'color', value: s.color });
    col.addEventListener('input', () => { s.color = col.value; commit(); });
    box.append(field('Color', col));
  }
  if (s.fill === 'grid') box.append(slider('Grid cells', s.gridDiv, 1, 32, 1, v => { s.gridDiv = v; commit(); }, v => `${v}`));
  box.append(el('p', { class: 'hint', text: 'Press G in either window to cycle Source → Grid → Solid on the selected surface.' }));
  box.append(checkInput('Visible', s.visible, v => { s.visible = v; commit(true); }));
  box.append(checkInput('Lock shape', s.locked, v => { s.locked = v; commit(); }));
  box.append(slider('Opacity', s.opacity, 0, 1, 0.01, v => { s.opacity = v; commit(); }, v => v.toFixed(2)));

  box.append(el('h3', { text: 'Type' }));
  box.append(field('Type', selectInput(s.kind, [{ value: 'flat', label: 'Flat (warped picture)' }, { value: 'sphere', label: '360° ball (panoramic strip wrapped round it)' }],
    v => { s.kind = v; if (v === 'sphere') C.applyOp(state, { type: 'setGrid', surfaceId: s.id, cols: 2, rows: 2 }); commit(true); })));
  box.append(checkInput('Add light (black is see-through, for layering over another surface)', s.additive, v => { s.additive = v; commit(); }));
  if (s.kind === 'sphere') {
    const sp = s.sphere;
    box.append(el('p', { class: 'hint', text: 'Drag the four corners so the dashed circle sits on the ball. The projector\'s throw ratio and lens offset come from this output\'s Setup template, so set those first. The source must be a 2:1 equirectangular strip (like a 360° video): its middle lands on the point of the ball facing projector 1, and anything moving right in the strip travels round the ball to the right as seen from projector 1.' }));
    box.append(slider('Position round the ball (°)', sp.az, -180, 180, 1, v => { sp.az = v; commit(); }, v => `${v}°`));
    box.append(el('p', { class: 'hint', text: 'Stand behind projector 1 (0°) facing the ball and walk right round it: a projector a third of the way round is at 120°, two thirds at 240° (or −120°). Height above or below the ball is worked out from where the ball sits in the frame, assuming the projector is level.' }));
    box.append(slider('Projector tilt (°)', sp.pitch, -45, 45, 0.5, v => { sp.pitch = v; commit(); }, v => `${v}°`));
    box.append(slider('Projector roll (°)', sp.roll ?? 0, -30, 30, 0.25, v => { sp.roll = v; commit(); }, v => `${v}°`));
    box.append(el('p', { class: 'hint', text: 'Roll: the projector is not level on its mount, so its grid runs at a slant across the neighbour\'s. Turn it until the equators cross parallel. Tilt: the projector is pitched up or down to aim at the ball.' }));
    box.append(slider('Overlap sharpness', sp.blendPow, 0.5, 8, 0.1, v => { sp.blendPow = v; commit(); }, v => v.toFixed(1)));
    box.append(slider('Blend gamma', sp.blendGamma, 1, 3, 0.05, v => { sp.blendGamma = v; commit(); }, v => v.toFixed(2)));
    box.append(el('p', { class: 'hint', text: 'Where projectors overlap each one\'s share follows how squarely it hits the surface; higher sharpness hands over faster. Blend gamma should match the projectors (2.2 is typical). Use Show → Grid on all of them: the lines must coincide on the ball.' }));
  }

  box.append(el('h3', { text: 'Warp grid' }));
  const cols = numInput(s.cols, C.MIN_GRID, C.MAX_GRID, 1);
  const rows = numInput(s.rows, C.MIN_GRID, C.MAX_GRID, 1);
  const apply = () => { C.applyOp(state, { type: 'setGrid', surfaceId: s.id, cols: +cols.value, rows: +rows.value }); commit(true); };
  cols.addEventListener('change', apply);
  rows.addEventListener('change', apply);
  if (s.kind === 'sphere') { cols.disabled = rows.disabled = true; }
  box.append(el('div', { class: 'row' }, field('Columns', cols), field('Rows', rows)));
  box.append(field('Between points', selectInput(s.interp, [{ value: 'smooth', label: 'Smooth curve' }, { value: 'linear', label: 'Straight lines' }], v => { s.interp = v; commit(); })));
  box.append(el('p', { class: 'hint', text: '2×2 is a corner pin (perspective-correct, for flat surfaces). More points let the image follow the object: Smooth bends through them (columns, domes), Straight creases at them (boxes, crosses, folded walls). Changing the grid keeps the current shape.' }));
  box.append(el('div', { class: 'row' },
    btn('Straighten', () => { C.applyOp(state, { type: 'flatten', surfaceId: s.id }); commit(); }),
    btn('Reset shape', () => { C.applyOp(state, { type: 'resetShape', surfaceId: s.id }); commit(); }),
    btn('Full frame', () => { C.applyOp(state, { type: 'fullFrame', surfaceId: s.id }); commit(true); })));
  box.append(el('p', { class: 'hint', text: 'Full frame = the whole projector, 1:1, for content made from a Content template.' }));

  box.append(el('h3', { text: 'Source crop' }));
  box.append(el('p', { class: 'hint', text: 'Which part of the source this surface shows (0–1). Use it to spread one wide video across several projectors.' }));
  for (const [k, label] of [['x', 'Left'], ['y', 'Top'], ['w', 'Width'], ['h', 'Height']]) {
    box.append(slider(label, s.uv[k], 0, 1, 0.001, v => { s.uv[k] = v; commit(); }, v => v.toFixed(3)));
  }
  const tn = numInput(2, 1, 8, 1), ti = numInput(1, 1, 8, 1);
  box.append(el('div', { class: 'row' }, field('Split into', tn), field('Piece #', ti),
    btn('Apply', () => { const n = C.clamp(+tn.value || 1, 1, 8), i = C.clamp(+ti.value || 1, 1, n); s.uv.x = (i - 1) / n; s.uv.w = 1 / n; s.uv.y = 0; s.uv.h = 1; commit(true); })));

  box.append(el('h3', { text: 'Mask' }));
  const mk = s.mask;
  box.append(checkInput('Use mask', mk.enabled, v => { if (v && mk.pts.length < 3) mk.pts = C.maskPreset('rect'); mk.enabled = v; commit(true); }));
  if (mk.enabled) {
    const arm = numInput(0.25, 0.02, 0.48, 0.01);
    const preset = kind => () => { C.applyOp(state, { type: 'setMask', surfaceId: s.id, preset: kind, arm: parseFloat(arm.value) || 0.25 }); commit(true); };
    box.append(el('div', { class: 'row wrap' }, btn('X cross', preset('x')), btn('Plus', preset('plus')), btn('Diamond', preset('diamond')), btn('Circle', preset('circle')), btn('Rectangle', preset('rect')), field('Arm width', arm)));
    box.append(el('p', { class: 'hint', text: `${mk.pts.length} points. Drag the pink diamonds in the preview or on the projector. Click one and press Insert (or +) to add a point after it, Delete to remove it.` }));
    box.append(el('div', { class: 'row' },
      btn('Add point', () => { C.applyOp(state, { type: 'addMaskPoint', surfaceId: s.id, after: state.selection.point?.mask ?? null }); commit(true); }),
      btn('Remove selected', () => { const i = state.selection.point?.mask; if (i != null) { C.applyOp(state, { type: 'removeMaskPoint', surfaceId: s.id, i }); commit(true); } })));
    box.append(slider('Mask soft edge', mk.feather, 0, 0.2, 0.002, v => { mk.feather = v; commit(); }, v => v.toFixed(3)));
    box.append(checkInput('Invert (light outside the shape)', mk.invert, v => { mk.invert = v; commit(); }));
  }

  box.append(el('h3', { text: 'Cut out other surfaces' }));
  const others = o.surfaces.filter(x => x !== s);
  if (!others.length) box.append(el('p', { class: 'hint', text: 'Add another surface (the object in front) and tick it here to punch its shape out of this one.' }));
  else {
    box.append(el('p', { class: 'hint', text: 'Ticked surfaces are punched out of this one, masks included, even while they are hidden. Use it for a wall behind an object.' }));
    for (const x of others) {
      box.append(checkInput(x.name, s.cutouts.includes(x.id), v => { s.cutouts = v ? [...s.cutouts, x.id] : s.cutouts.filter(id => id !== x.id); commit(); }));
    }
    box.append(slider('Expand cut', s.cutExpand, 0, 100, 1, v => { s.cutExpand = v; commit(); }, v => `${v}px`));
    box.append(el('p', { class: 'hint', text: 'Grows the hole for a safety margin. The hole edge is soft if the cut surface has soft edges or a mask soft edge.' }));
  }

  box.append(el('h3', { text: 'Soft edges' }));
  for (const [k, label] of [['l', 'Left'], ['r', 'Right'], ['t', 'Top'], ['b', 'Bottom']]) {
    box.append(slider(label, s.feather[k], 0, 0.5, 0.005, v => { s.feather[k] = v; commit(); }, v => v.toFixed(3)));
  }

  box.append(el('h3', { text: 'Stacking' }));
  const i = o.surfaces.indexOf(s);
  box.append(el('div', { class: 'row' },
    btn('Send back', () => { if (i > 0) { o.surfaces.splice(i, 1); o.surfaces.splice(i - 1, 0, s); commit(true); } }),
    btn('Bring forward', () => { if (i < o.surfaces.length - 1) { o.surfaces.splice(i, 1); o.surfaces.splice(i + 1, 0, s); commit(true); } }),
    btn('Duplicate', () => {
      const copy = JSON.parse(JSON.stringify(s));
      copy.id = C.uid(); copy.name = s.name + ' copy';
      for (const row of copy.pts) for (const p of row) { p.x += 0.03; p.y += 0.03; }
      o.surfaces.splice(i + 1, 0, copy);
      state.selection = { outputId: o.id, surfaceId: copy.id, point: null };
      commit(true);
    })));
  box.append(el('div', { class: 'row end' }, btn('Delete surface', () => {
    o.surfaces = o.surfaces.filter(x => x !== s);
    for (const x of o.surfaces) x.cutouts = (x.cutouts || []).filter(id => id !== s.id);
    state.selection = { outputId: o.id, surfaceId: null, point: null };
    commit(true);
  }, 'danger')));
  return box;
}

function settingsPanel(collapsed) {
  const d = el('details', { class: 'panel settings' });
  if (!collapsed) d.open = true;
  d.append(el('summary', { text: 'Show settings' }));
  d.append(field('Video path', selectInput(state.videoPath || 'direct', [{ value: 'direct', label: 'Direct (default)' }, { value: 'canvas', label: 'Via 2D canvas (driver workaround)' }], v => { state.videoPath = v; commit(); })));
  d.append(el('p', { class: 'hint' }, 'If video stays frozen on this machine, open ', el('a', { href: 'test-video.html', target: '_blank', text: 'test-video.html' }), ' to see which path works, then pick it here. Applies to projector windows too.'));
  d.append(slider('Mesh density', state.meshDensity, 8, 128, 8, v => { state.meshDensity = v; commit(); }, v => `${v}`));
  d.append(el('p', { class: 'hint', text: 'Subdivisions per surface. Higher = smoother curves, more GPU work. 48 is plenty for most walls.' }));
  d.append(el('p', { class: 'hint', text: 'Everything autosaves in this browser. Use Save as… for a file you can reload later or on another machine.' }));
  return d;
}

// ---------------------------------------------------------------- preview

const previewCanvas = $('#preview');
const overlayCanvas = $('#previewOverlay');
let renderer = null;
let media = null;
try {
  renderer = new Renderer(previewCanvas);
  media = new MediaProvider(renderer.gl, { audio: true, under: $('#previewWrap') });
  media.onMeta = (id, info) => { mediaInfo.set(id, { ...info, error: false }); rebuildLists(); };
  media.onError = id => { mediaInfo.set(id, { duration: 0, width: 0, height: 0, error: true }); rebuildLists(); };

} catch (e) {
  toast(e.message, 60000);
}

new Editor(overlayCanvas, {
  get: () => ({ state, output: currentOutput() }),
  send: op => { if (C.applyOp(state, op)) commit(['select', 'cycleFill', 'addMaskPoint', 'removeMaskPoint'].includes(op.type), { history: !VIEW_OPS.includes(op.type), key: opKey(op) }); },
});

function fitPreview() {
  const wrap = $('#previewWrap');
  const o = currentOutput();
  const aw = Math.max(50, wrap.clientWidth - 24), ah = Math.max(50, wrap.clientHeight - 24);
  let w = aw, h = ah;
  if (o && o.width > 0 && o.height > 0) {
    const ar = o.width / o.height;
    if (aw / ah > ar) { h = ah; w = ah * ar; } else { w = aw; h = aw / ar; }
  }
  w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
  const dpr = window.devicePixelRatio || 1;
  if (media) { const hs = media.holder.style; hs.left = '50%'; hs.top = '50%'; hs.transform = 'translate(-50%, -50%)'; hs.width = w + 'px'; hs.height = h + 'px'; }
  for (const c of [previewCanvas, overlayCanvas]) {
    if (c.style.width !== w + 'px') c.style.width = w + 'px';
    if (c.style.height !== h + 'px') c.style.height = h + 'px';
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (c.width !== pw) c.width = pw;
    if (c.height !== ph) c.height = ph;
  }
}

let activeTab = 'preview';
const camera = new CameraPanel($('#cameraPanel'), {
  getState: () => state,
  currentOutput,
  send: op => { if (C.applyOp(state, op)) commit(op.type === 'select', { history: !VIEW_OPS.includes(op.type), key: opKey(op) }); },
  commit,
  bc,
  toast,
});
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  activeTab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $('#cameraPanel').hidden = activeTab !== 'camera';
  $('#previewWrap').hidden = activeTab !== 'preview';
  $('#previewWrap').nextElementSibling.hidden = activeTab !== 'preview';
  needFit = true;
}));

// The control window only decodes what it shows in the preview, plus whatever is
// audible when the audio slider is up. Preview off + audio at 0 = no decoding here.
function usedInControl() {
  const o = currentOutput();
  const ids = new Set();
  if (previewMedia && o) for (const id of C.usedMedia(state, o)) ids.add(id);
  if (state.transport.volume > 0) {
    for (const id of C.usedMedia(state)) ids.add(id);
    for (const m of state.media) if (m.kind === 'audio') ids.add(m.id);   // soundtracks play from here
  }
  return mid => ids.has(mid);
}
let fpsCount = 0, fpsAt = performance.now(), fps = 0;

let frameMs = 0, worstMs = 0, needFit = true;
window.addEventListener('resize', () => { needFit = true; });

const diag = { errors: 0, lastError: '', frames: 0 };
function frame() {
  try { frameBody(); } catch (e) { diag.errors++; diag.lastError = (e && e.message) || String(e); }
  if (renderer && renderer.lost && !diag.reloading) { diag.reloading = true; toast('GPU context lost — reloading in 2 s', 5000); setTimeout(() => location.reload(), 2000); }
  requestAnimationFrame(frame);
}
function frameBody() {
  const t0 = performance.now();
  diag.frames++;
  if (++fpsCount >= 30) { fps = Math.round(fpsCount * 1000 / (t0 - fpsAt)); fpsCount = 0; fpsAt = t0; worstMs = 0; }
  if (media) { media.uploadVia = state.videoPath === 'canvas' ? 'canvas' : 'direct'; media.sync(state, usedInControl()); media.tick(state.transport); }
  if (activeTab === 'camera') { camera.draw(); updateTransportUI(); return; }
  if (needFit) { fitPreview(); needFit = false; }
  const o = currentOutput();
  const ctx = overlayCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (o && renderer) {
    renderer.render(o, state, media);
    drawOverlay(ctx, o, state, overlayCanvas.width / dpr, overlayCanvas.height / dpr, { density: state.meshDensity, handles: true });
    const st = media ? media.stats() : { videos: 0, dropped: 0, errors: 0 };
    const stills = !previewMedia && C.usedMedia(state, o).size > 0;
    $('#previewBadge').hidden = !stills;
    $('#previewInfo').textContent = `${o.name} · ${o.width}×${o.height} · ${fps} fps · ${frameMs.toFixed(1)} ms (worst ${worstMs.toFixed(0)}) · ${st.videos ? st.videos + ' video' + (st.videos === 1 ? '' : 's') + ' decoding here' : 'poster frames, no decoding here'}` + (st.dropped ? ` · ${st.dropped} dropped` : '') + (st.errors ? ` · ${st.errors} cannot play` : '');
  } else {
    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    $('#previewInfo').textContent = '';
  }
  updateTransportUI();
  frameMs = performance.now() - t0;
  if (frameMs > worstMs) worstMs = frameMs;
  updateDiag();
}

let showDiag = false;
function updateDiag() {
  const box = $('#diag');
  if (!showDiag) { if (!box.hidden) box.hidden = true; return; }
  if (box.hidden) box.hidden = false;
  if (diag.frames % 5 && box.textContent) return;
  const o = currentOutput();
  box.textContent = [
    `CONTROL  frames=${diag.frames} fps=${fps} frameMs=${frameMs.toFixed(1)} errors=${diag.errors}${diag.lastError ? ' last=' + diag.lastError : ''} glLost=${renderer ? renderer.lost : 'no renderer'} otherControl=${otherControlSeen ? 'YES at ' + new Date(otherControlSeen).toLocaleTimeString() : 'no'} playPresses=${diag.playPresses || 0}`,
    `transport playing=${state.transport.playing} clock=${C.transportTime(state.transport).toFixed(2)} volume=${state.transport.volume} previewVideo=${previewMedia} videoPath=${state.videoPath || 'direct'}`,
    `output=${o ? o.name : '-'} surfaces=${o ? o.surfaces.map(s => `${s.name}[${s.visible ? 'on' : 'off'},${s.fill},${state.media.find(m => m.id === s.mediaId)?.name ?? 'none'}]`).join(' ') : '-'}`,
    ...(media ? media.lines(state.transport) : ['no media provider']),
    'transport log: ' + (tlog.length ? tlog.join(' | ') : '(nothing yet)'),
  ].join('\n');
}

// Cheap metadata probe (no decoding) for files the control window is not playing.
const probed = new Set();
function probeMedia() {
  for (const m of state.media) {
    if (m.missing || probed.has(m.id) || mediaInfo.has(m.id)) continue;
    probed.add(m.id);
    if (m.kind === 'video') {
      // Metadata only: no decoding, no seeking. Hardware decoders are a scarce resource
      // (a Qualcomm chip has a handful), and a stuck thumbnail seek can hold one forever.
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      v.addEventListener('loadedmetadata', () => { if (!mediaInfo.has(m.id)) { mediaInfo.set(m.id, { duration: v.duration, width: v.videoWidth, height: v.videoHeight, error: false }); rebuildLists(); } v.removeAttribute('src'); v.load(); });
      v.addEventListener('error', () => { if (!mediaInfo.has(m.id)) { mediaInfo.set(m.id, { duration: 0, width: 0, height: 0, error: true }); rebuildLists(); } });
      v.src = m.url;
    } else if (m.kind === 'audio') {
      const a = document.createElement('audio');
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', () => { if (!mediaInfo.has(m.id)) { mediaInfo.set(m.id, { duration: a.duration, width: 0, height: 0, error: false }); rebuildLists(); } a.removeAttribute('src'); a.load(); });
      a.addEventListener('error', () => { if (!mediaInfo.has(m.id)) { mediaInfo.set(m.id, { duration: 0, width: 0, height: 0, error: true }); rebuildLists(); } });
      a.src = m.url;
    } else {
      const i = new Image();
      i.addEventListener('load', () => {
        if (!mediaInfo.has(m.id)) { mediaInfo.set(m.id, { duration: 0, width: i.naturalWidth, height: i.naturalHeight, error: false }); rebuildLists(); }
        if (media) media.setPoster(m.id, i);
      });
      i.addEventListener('error', () => { if (!mediaInfo.has(m.id)) { mediaInfo.set(m.id, { duration: 0, width: 0, height: 0, error: true }); rebuildLists(); } });
      i.src = m.url;
    }
  }
}

// ---------------------------------------------------------------- transport

function longestDuration() {
  let d = 0;
  for (const m of state.media) { const i = mediaInfo.get(m.id); if (i && i.duration > d) d = i.duration; }
  return d;
}
const tlog = [];
function logT(what) { tlog.push(`${new Date().toLocaleTimeString()} ${what} -> playing=${state.transport.playing}`); if (tlog.length > 8) tlog.shift(); }
function play() {
  diag.playPresses = (diag.playPresses || 0) + 1;
  const tr = state.transport;
  setTimeout(() => logT('play()'), 0);
  if (tr.playing) { tr.pausedAt = C.transportTime(tr); tr.playing = false; }
  else {
    tr.startedAt = Date.now(); tr.playing = true;
    const notSource = state.outputs.flatMap(o => o.surfaces.filter(s => s.visible && s.fill !== 'source' && s.mediaId));
    if (notSource.length) toast(`${notSource.map(s => s.name).join(', ')}: Show is set to ${notSource[0].fill === 'grid' ? 'Grid' : 'Solid color'}, so no video there. Set Show to Source (or press G).`, 8000);
  }
  commit(false, { history: false });
}
function stop() {
  const tr = state.transport;
  setTimeout(() => logT('stop()'), 0);
  tr.playing = false; tr.pausedAt = 0;
  commit(false, { history: false });
}
function seek(t) {
  const tr = state.transport;
  tr.pausedAt = Math.max(0, t); tr.startedAt = Date.now();
  commit(false, { history: false });
}

let scrubbing = false;
function updateTransportUI() {
  const tr = state.transport;
  const dur = longestDuration();
  const t = C.transportTime(tr);
  const shown = dur > 0 && tr.loop ? t % dur : Math.min(t, dur || t);
  $('#timeDisplay').textContent = `${fmtTime(shown)} / ${fmtTime(dur)}`;
  $('#btnPlay').textContent = tr.playing ? '❚❚' : '▶';
  const sc = $('#scrub');
  if (!scrubbing) { sc.max = dur || 1; sc.value = shown; }
}

// ---------------------------------------------------------------- project file

function exportShow() {
  const data = JSON.stringify({ ...state, transport: { ...state.transport, playing: false, pausedAt: 0 } }, null, 2);
  const a = el('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: `${state.name.replace(/[^\w.-]+/g, '_') || 'show'}.pmap.json` });
  document.body.append(a); a.click(); a.remove();
}
function importShow(file) {
  file.text().then(txt => {
    const raw = JSON.parse(txt);
    if (raw.version !== 1 || !Array.isArray(raw.outputs)) throw new Error('bad file');
    state = normalize(raw);
    logT('Open show file');
    mediaInfo.clear(); probed.clear();
    commit(true);
    toast(`Opened ${file.name}`);
  }).catch(() => toast('That is not a show file from this app.'));
}

// ---------------------------------------------------------------- wiring

$('#showName').addEventListener('change', e => { state.name = e.target.value.trim() || 'Untitled show'; commit(); });
$('#btnNew').addEventListener('click', () => { if (confirm('Start a new empty show? The current one stays saved only if you exported it.')) { state = C.defaultState(); mediaInfo.clear(); probed.clear(); commit(true); } });
$('#btnImport').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', e => { if (e.target.files[0]) importShow(e.target.files[0]); e.target.value = ''; });
$('#btnExport').addEventListener('click', exportShow);
$('#btnOpenAll').addEventListener('click', () => state.outputs.forEach(o => openOutput(o)));
$('#btnOpenSpan').addEventListener('click', openSpanned);
$('#btnAddMedia').addEventListener('click', () => $('#fileMedia').click());
$('#fileMedia').addEventListener('change', e => { addMediaFiles(e.target.files); e.target.value = ''; });
$('#btnScan').addEventListener('click', scanFolder);
$('#btnAddOutput').addEventListener('click', addOutput);
$('#chkPreviewMedia').addEventListener('change', e => { previewMedia = e.target.checked; });
$('#chkDiag').addEventListener('change', e => { showDiag = e.target.checked; });
$('#btnPlay').addEventListener('click', play);
$('#btnStop').addEventListener('click', stop);
$('#chkLoop').addEventListener('change', e => { state.transport.loop = e.target.checked; commit(false, { history: false }); });
$('#selRate').addEventListener('change', e => { seek(C.transportTime(state.transport)); state.transport.rate = parseFloat(e.target.value); commit(false, { history: false }); });
$('#vol').addEventListener('input', e => { state.transport.volume = parseFloat(e.target.value); commit(false, { history: false }); });
$('#btnUndo').addEventListener('click', undo);
$('#btnRedo').addEventListener('click', redo);
document.addEventListener('pointerup', endGesture);
document.addEventListener('keyup', e => { if (e.key.startsWith('Arrow')) endGesture(); });
const scrub = $('#scrub');
scrub.addEventListener('pointerdown', () => { scrubbing = true; });
scrub.addEventListener('input', () => seek(parseFloat(scrub.value)));
scrub.addEventListener('change', () => { scrubbing = false; seek(parseFloat(scrub.value)); });
document.addEventListener('pointerup', () => { scrubbing = false; });

document.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  const typing = (tag === 'INPUT' && ['text', 'number'].includes(e.target.type)) || tag === 'TEXTAREA';
  if ((e.ctrlKey || e.metaKey) && !typing && (e.key === 'z' || e.key === 'Z')) { e.shiftKey ? redo() : undo(); e.preventDefault(); return; }
  if ((e.ctrlKey || e.metaKey) && !typing && (e.key === 'y' || e.key === 'Y')) { redo(); e.preventDefault(); return; }
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.code === 'Space') { if (tag === 'BUTTON') e.target.blur(); play(); e.preventDefault(); }
});
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); if (e.dataTransfer?.files?.length) addMediaFiles(e.dataTransfer.files); });
window.addEventListener('beforeunload', () => { for (const w of outputWindows.values()) if (w && !w.closed) w.close(); });
setInterval(updateStatusTexts, 1000);

$('#chkLoop').checked = state.transport.loop;
$('#selRate').value = String(state.transport.rate);
$('#vol').value = String(state.transport.volume);
if (location.protocol === 'file:') toast('Open this through serve.ps1 (http://127.0.0.1:8765/) — file:// cannot sync the projector windows.', 60000);
// Diagnostics: type pmapDebug() in the browser console (F12) to see what every media element is doing.
window.pmapDebug = () => ({
  transport: { ...state.transport, now: C.transportTime(state.transport) },
  previewMedia, volume: state.transport.volume,
  wanted: [...state.media].map(m => ({ name: m.name, kind: m.kind, missing: !!m.missing, keep: usedInControl()(m.id), info: mediaInfo.get(m.id) || null })),
  page: { visibility: document.visibilityState, hidden: document.hidden, userAgent: navigator.userAgent },
  elements: media ? [...media.items.values()].map(it => { const q = it.el.getVideoPlaybackQuality?.(); const b = it.el.buffered; return { kind: it.kind, src: it.el.currentSrc, readyState: it.el.readyState, networkState: it.el.networkState, paused: it.el.paused, playbackRate: it.el.playbackRate, currentTime: it.el.currentTime, duration: it.el.duration, muted: it.el.muted, inDOM: it.el.isConnected, buffered: b && b.length ? `${b.start(0).toFixed(1)}-${b.end(b.length - 1).toFixed(1)}s (${b.length})` : 'none', decodedFrames: q ? q.totalVideoFrames : null, droppedFrames: q ? q.droppedVideoFrames : null, error: it.el.error ? `${it.el.error.code}: ${it.el.error.message}` : (it.playError || null), uploaded: it.uploaded }; }) : 'no renderer',
  surfaces: state.outputs.flatMap(o => o.surfaces.map(s => ({ output: o.name, name: s.name, visible: s.visible, fill: s.fill, media: state.media.find(m => m.id === s.mediaId)?.name ?? null }))),
});

rebuildLists();
rebuildInspector();
broadcast();
probeMedia();
updateUndoButtons();
requestAnimationFrame(frame);
