// core.js — shared state model, geometry and edit operations.
// Used by both the control window (index.html) and projector windows (output.html).

export const CHANNEL = 'pmap-v1';
export const STORAGE_KEY = 'pmap.state.v1';
export const MIN_GRID = 2;
export const MAX_GRID = 12;
export const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'];
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
export const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'];

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function kindFromName(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  return null;
}

// ---------------------------------------------------------------- state

export function defaultState() {
  return {
    version: 1,
    name: 'Untitled show',
    meshDensity: 48,            // subdivisions per surface edge (quality of curves)
    videoPath: 'direct',        // 'direct' | 'canvas': how video frames reach WebGL (see test-video.html)
    media: [],                  // {id, name, url, kind, persistent, missing?}
    outputs: [],                // see makeOutput
    transport: { playing: false, startedAt: 0, pausedAt: 0, rate: 1, loop: true, volume: 0 },
    selection: { outputId: null, surfaceId: null, point: null },
  };
}

export function gridPoints(cols, rows, inset = 0.1) {
  const pts = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ x: inset + (1 - 2 * inset) * c / (cols - 1), y: inset + (1 - 2 * inset) * r / (rows - 1) });
    }
    pts.push(row);
  }
  return pts;
}

export function makeOutput(index) {
  return {
    id: uid(),
    name: `Projector ${index}`,
    width: 1920,
    height: 1080,
    surfaces: [],
    blend: {
      left: { w: 0, g: 2.2 }, right: { w: 0, g: 2.2 },
      top: { w: 0, g: 2.2 }, bottom: { w: 0, g: 2.2 },
    },
    brightness: 1,
    gamma: 1,
    testPattern: false,
    editOverlay: true,
  };
}

export function makeSurface(index, mediaId = null) {
  return {
    id: uid(),
    name: `Surface ${index}`,
    mediaId,
    cols: 2,
    rows: 2,
    pts: gridPoints(2, 2, 0.15),         // normalized output coords, y down
    uv: { x: 0, y: 0, w: 1, h: 1 },      // crop of the source
    opacity: 1,
    feather: { l: 0, r: 0, t: 0, b: 0 },  // soft edge, fraction of the surface
    fill: 'source',                       // 'source' | 'grid' | 'color'
    color: '#ffffff',                     // used by grid lines and solid fill
    gridDiv: 8,                           // grid cells across the surface
    interp: 'smooth',                     // 'smooth' (curves through points) | 'linear' (straight between points)
    mask: { enabled: false, pts: [], feather: 0, invert: false },  // polygon in surface space (u,v)
    cutouts: [],                          // ids of surfaces whose shapes are punched out of this one
    cutExpand: 0,                         // grow the hole by this many output pixels
    visible: true,
    locked: false,
  };
}

export const FILL_MODES = ['source', 'grid', 'color'];
export const MAX_MASK_PTS = 32;

// Fill in fields added after a show was saved.
export function upgradeSurface(s) {
  if (!FILL_MODES.includes(s.fill)) s.fill = 'source';
  if (typeof s.color !== 'string') s.color = '#ffffff';
  if (!(s.gridDiv >= 1)) s.gridDiv = 8;
  if (s.interp !== 'linear') s.interp = 'smooth';
  if (!s.mask || !Array.isArray(s.mask.pts)) s.mask = { enabled: false, pts: [], feather: 0, invert: false };
  if (!Array.isArray(s.cutouts)) s.cutouts = [];
  if (!(s.cutExpand >= 0)) s.cutExpand = 0;
  return s;
}

// Mask presets in surface space. `a` is the arm width as a fraction of the surface (0–0.5).
export function maskPreset(kind, a = 0.25) {
  a = clamp(a, 0.02, 0.48);
  if (kind === 'x') {
    return [
      [0, 0], [a, 0], [0.5, 0.5 - a], [1 - a, 0], [1, 0], [1, a], [0.5 + a, 0.5], [1, 1 - a],
      [1, 1], [1 - a, 1], [0.5, 0.5 + a], [a, 1], [0, 1], [0, 1 - a], [0.5 - a, 0.5], [0, a],
    ].map(([u, v]) => ({ u, v }));
  }
  if (kind === 'plus') {
    const h = a / 2;
    return [
      [0.5 - h, 0], [0.5 + h, 0], [0.5 + h, 0.5 - h], [1, 0.5 - h], [1, 0.5 + h], [0.5 + h, 0.5 + h],
      [0.5 + h, 1], [0.5 - h, 1], [0.5 - h, 0.5 + h], [0, 0.5 + h], [0, 0.5 - h], [0.5 - h, 0.5 - h],
    ].map(([u, v]) => ({ u, v }));
  }
  if (kind === 'diamond') return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]].map(([u, v]) => ({ u, v }));
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => ({ u, v }));
}

// Media ids used by visible surfaces of one output (or of every output when null).
export function usedMedia(state, output = null) {
  const ids = new Set();
  for (const o of output ? [output] : state.outputs) for (const s of o.surfaces) if (s.visible && s.mediaId && s.fill !== 'color') ids.add(s.mediaId);
  return ids;
}

export function findOutput(state, id) {
  return state.outputs.find(o => o.id === id) || null;
}

export function findSurface(state, id) {
  for (const output of state.outputs) {
    const surface = output.surfaces.find(s => s.id === id);
    if (surface) return { output, surface };
  }
  return null;
}

// ---------------------------------------------------------------- transport

// Master clock in seconds. All windows share the machine clock, so every
// window computes the same value from the same transport record.
export function transportTime(tr, now = Date.now()) {
  return tr.playing ? tr.pausedAt + ((now - tr.startedAt) / 1000) * tr.rate : tr.pausedAt;
}

// ---------------------------------------------------------------- geometry

// Homography mapping the unit square to a quad. Corners: TL, TR, BR, BL.
// (Heckbert, "Fundamentals of Texture Mapping and Image Warping".)
export function squareToQuad([p0, p1, p2, p3]) {
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
    g = 0; h = 0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1 || 1e-12;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + h * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + h * p3.y; f = p0.y;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + c) / w, y: (d * u + e * v + f) / w };
  };
}

export function cornerH(s) {
  return squareToQuad([
    s.pts[0][0], s.pts[0][s.cols - 1],
    s.pts[s.rows - 1][s.cols - 1], s.pts[s.rows - 1][0],
  ]);
}

function catmullRom(p0, p1, p2, p3, t) {
  return 0.5 * ((2 * p1) + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

function lerp1D(arr, t) {
  const n = arr.length;
  if (n === 1) return arr[0];
  const x = t * (n - 1);
  let i = Math.floor(x);
  if (i >= n - 1) i = n - 2;
  const f = x - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

// Interpolate an array of samples at t in [0,1] with a clamped Catmull-Rom spline.
function sample1D(arr, t) {
  const n = arr.length;
  if (n === 1) return arr[0];
  const x = t * (n - 1);
  let i = Math.floor(x);
  if (i >= n - 1) i = n - 2;
  const f = x - i;
  const g = k => arr[Math.max(0, Math.min(n - 1, k))];
  return catmullRom(g(i - 1), g(i), g(i + 1), g(i + 2), f);
}

// Returns (u,v) -> {x,y}: the corner homography plus a smooth offset field
// through the interior control points. Flat surfaces stay perspective-correct,
// curved ones follow the dragged points exactly.
export function surfaceFn(s) {
  const H = cornerH(s);
  const { cols, rows } = s;
  if (cols === 2 && rows === 2) return H;
  const offX = [], offY = [];
  for (let r = 0; r < rows; r++) {
    offX.push([]); offY.push([]);
    for (let c = 0; c < cols; c++) {
      const h = H(c / (cols - 1), r / (rows - 1));
      offX[r].push(s.pts[r][c].x - h.x);
      offY[r].push(s.pts[r][c].y - h.y);
    }
  }
  const tx = new Array(rows), ty = new Array(rows);
  const S = s.interp === 'linear' ? lerp1D : sample1D;
  return (u, v) => {
    const h = H(u, v);
    for (let r = 0; r < rows; r++) { tx[r] = S(offX[r], u); ty[r] = S(offY[r], u); }
    return { x: h.x + S(tx, v), y: h.y + S(ty, v) };
  };
}

// Output coords -> surface (u,v), by Newton iteration on surfaceFn. Good enough for dragging mask points.
export function surfaceInverse(s) {
  const f = surfaceFn(s);
  return (x, y, guess = { u: 0.5, v: 0.5 }) => {
    let u = guess.u, v = guess.v;
    for (let i = 0; i < 20; i++) {
      const p = f(u, v);
      const ex = p.x - x, ey = p.y - y;
      if (Math.abs(ex) + Math.abs(ey) < 1e-7) break;
      const h = 1e-4;
      const a = f(u + h, v), b = f(u, v + h);
      const j00 = (a.x - p.x) / h, j01 = (b.x - p.x) / h, j10 = (a.y - p.y) / h, j11 = (b.y - p.y) / h;
      const det = j00 * j11 - j01 * j10;
      if (Math.abs(det) < 1e-12) break;
      u -= (j11 * ex - j01 * ey) / det;
      v -= (-j10 * ex + j00 * ey) / det;
      u = clamp(u, -1, 2); v = clamp(v, -1, 2);
    }
    return { u, v };
  };
}

const meshCache = new Map();

// Dense triangle mesh for a surface (cached per surface while its shape is unchanged).
export function evalMesh(s, density) {
  const n = clamp(density | 0, 4, 160);
  const key = `${s.cols}x${s.rows}:${n}:${s.interp}:` + s.pts.flat().map(p => p.x.toFixed(5) + ',' + p.y.toFixed(5)).join(';');
  const hit = meshCache.get(s.id);
  if (hit && hit.key === key) return hit.mesh;
  const f = surfaceFn(s);
  const nx = n + 1, ny = n + 1;
  const pos = new Float32Array(nx * ny * 2);
  const uv = new Float32Array(nx * ny * 2);
  let k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const u = i / n, v = j / n;
      const p = f(u, v);
      pos[k * 2] = p.x; pos[k * 2 + 1] = p.y;
      uv[k * 2] = u; uv[k * 2 + 1] = v;
      k++;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let t = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }
  const mesh = { pos, uv, idx, nx, ny, n };
  meshCache.set(s.id, { key, mesh });
  return mesh;
}

// Boundary ring of a mesh, clockwise from the top-left.
export function outline(mesh) {
  const { pos, nx, ny } = mesh;
  const P = i => ({ x: pos[i * 2], y: pos[i * 2 + 1] });
  const out = [];
  for (let i = 0; i < nx; i++) out.push(P(i));
  for (let j = 1; j < ny; j++) out.push(P(j * nx + nx - 1));
  for (let i = nx - 2; i >= 0; i--) out.push(P((ny - 1) * nx + i));
  for (let j = ny - 2; j >= 1; j--) out.push(P(j * nx));
  return out;
}

export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- edits

// Moving a corner re-homographies the surface and carries the interior points
// along with their offsets, so a curved surface keeps its curve.
function setPoint(s, r, c, x, y) {
  const isCorner = (r === 0 || r === s.rows - 1) && (c === 0 || c === s.cols - 1);
  if (!isCorner || (s.rows === 2 && s.cols === 2)) { s.pts[r][c] = { x, y }; return; }
  const H = cornerH(s);
  const off = s.pts.map((row, ri) => row.map((p, ci) => {
    const h = H(ci / (s.cols - 1), ri / (s.rows - 1));
    return { x: p.x - h.x, y: p.y - h.y };
  }));
  s.pts[r][c] = { x, y };
  const H2 = cornerH(s);
  for (let ri = 0; ri < s.rows; ri++) {
    for (let ci = 0; ci < s.cols; ci++) {
      const corner = (ri === 0 || ri === s.rows - 1) && (ci === 0 || ci === s.cols - 1);
      if (corner) continue;
      const h = H2(ci / (s.cols - 1), ri / (s.rows - 1));
      s.pts[ri][ci] = { x: h.x + off[ri][ci].x, y: h.y + off[ri][ci].y };
    }
  }
}

export function resampleGrid(s, cols, rows) {
  cols = clamp(cols | 0, MIN_GRID, MAX_GRID);
  rows = clamp(rows | 0, MIN_GRID, MAX_GRID);
  const f = surfaceFn(s);
  const pts = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) row.push(f(c / (cols - 1), r / (rows - 1)));
    pts.push(row);
  }
  s.cols = cols; s.rows = rows; s.pts = pts;
}

// Applies an edit operation to the state. Returns true when something changed.
export function applyOp(state, op) {
  switch (op.type) {
    case 'select':
      state.selection = { outputId: op.outputId ?? null, surfaceId: op.surfaceId ?? null, point: op.point ?? null };
      return true;
    case 'movePoint': {
      const f = findSurface(state, op.surfaceId);
      if (!f || f.surface.locked) return false;
      const s = f.surface;
      if (op.r < 0 || op.r >= s.rows || op.c < 0 || op.c >= s.cols) return false;
      setPoint(s, op.r, op.c, op.x, op.y);
      return true;
    }
    case 'moveSurface': {
      const f = findSurface(state, op.surfaceId);
      if (!f || f.surface.locked) return false;
      for (const row of f.surface.pts) for (const p of row) { p.x += op.dx; p.y += op.dy; }
      return true;
    }
    case 'setGrid': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      resampleGrid(f.surface, op.cols, op.rows);
      if (state.selection.surfaceId === f.surface.id) state.selection.point = null;
      return true;
    }
    case 'flatten': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      const s = f.surface, H = cornerH(s);
      for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) s.pts[r][c] = H(c / (s.cols - 1), r / (s.rows - 1));
      return true;
    }
    case 'fullFrame': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      const s = f.surface;
      s.cols = 2; s.rows = 2;
      s.pts = [[{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 1 }, { x: 1, y: 1 }]];
      s.uv = { x: 0, y: 0, w: 1, h: 1 };
      if (state.selection.surfaceId === s.id) state.selection.point = null;
      return true;
    }
    case 'resetShape': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      f.surface.pts = gridPoints(f.surface.cols, f.surface.rows, 0.15);
      return true;
    }
    case 'moveMaskPoint': {
      const f = findSurface(state, op.surfaceId);
      if (!f || f.surface.locked) return false;
      const m = upgradeSurface(f.surface).mask;
      if (op.i < 0 || op.i >= m.pts.length) return false;
      m.pts[op.i] = { u: op.u, v: op.v };
      return true;
    }
    case 'addMaskPoint': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      const m = upgradeSurface(f.surface).mask;
      if (m.pts.length >= MAX_MASK_PTS) return false;
      if (!m.pts.length) { m.pts = maskPreset('rect'); m.enabled = true; return true; }
      const i = op.after != null ? clamp(op.after | 0, 0, m.pts.length - 1) : m.pts.length - 1;
      const a = m.pts[i], b = m.pts[(i + 1) % m.pts.length];
      m.pts.splice(i + 1, 0, { u: (a.u + b.u) / 2, v: (a.v + b.v) / 2 });
      if (state.selection.surfaceId === f.surface.id) state.selection.point = { mask: i + 1 };
      return true;
    }
    case 'removeMaskPoint': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      const m = upgradeSurface(f.surface).mask;
      if (m.pts.length <= 3 || op.i < 0 || op.i >= m.pts.length) return false;
      m.pts.splice(op.i, 1);
      if (state.selection.surfaceId === f.surface.id) state.selection.point = null;
      return true;
    }
    case 'setMask': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      const m = upgradeSurface(f.surface).mask;
      if (op.preset) { m.pts = maskPreset(op.preset, op.arm); m.enabled = true; }
      if (op.enabled != null) m.enabled = !!op.enabled;
      if (op.feather != null) m.feather = clamp(op.feather, 0, 0.5);
      if (op.invert != null) m.invert = !!op.invert;
      if (state.selection.surfaceId === f.surface.id && state.selection.point?.mask != null) state.selection.point = null;
      return true;
    }
    case 'setFill': {
      const f = findSurface(state, op.surfaceId);
      if (!f || !FILL_MODES.includes(op.fill)) return false;
      f.surface.fill = op.fill;
      return true;
    }
    case 'cycleFill': {
      const f = findSurface(state, op.surfaceId);
      if (!f) return false;
      const s = upgradeSurface(f.surface);
      s.fill = FILL_MODES[(FILL_MODES.indexOf(s.fill) + 1) % FILL_MODES.length];
      return true;
    }
    case 'toggle': {
      const o = findOutput(state, op.outputId);
      if (!o) return false;
      o[op.key] = op.value ?? !o[op.key];
      return true;
    }
    case 'outputSize': {
      const o = findOutput(state, op.outputId);
      if (!o) return false;
      o.width = op.width; o.height = op.height;
      return true;
    }
    default:
      return false;
  }
}
