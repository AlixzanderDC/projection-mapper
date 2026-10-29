// export.js — content templates: the exact projected shape at projector resolution.
import { evalMesh, outline, surfaceFn } from './core.js';
import { Renderer } from './render.js';

// White-on-black PNG of everything the projector lights (hard edges, no blend).
export function silhouettePng(output, state, only = null) {   // only: a surface id to render on its own
  const W = output.width, H = output.height;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const r = new Renderer(canvas);
  const flat = {
    ...output,
    brightness: 1, gamma: 1, ramp: { top: 1, bottom: 1, left: 1, right: 1 }, flip: 'none',   // the stencil is the upright frame
    blend: { left: { w: 0, g: 1 }, right: { w: 0, g: 1 }, top: { w: 0, g: 1 }, bottom: { w: 0, g: 1 } },
    surfaces: output.surfaces.map(s => ({
      ...s, fill: 'color', color: '#ffffff', opacity: 1,
      visible: only ? s.id === only : s.visible,
      feather: { l: 0, r: 0, t: 0, b: 0 },
      mask: s.mask ? { ...s.mask, feather: 0 } : s.mask,
    })),
  };
  r.render(flat, state, null);
  const gl = r.gl;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const img = out.getContext('2d').createImageData(W, H);
  const row = W * 4;
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * row, (H - y) * row), y * row); // GL rows are bottom-up
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  out.getContext('2d').putImageData(img, 0, 0);
  return new Promise(res => out.toBlob(res, 'image/png'));
}

// Vector guide: frame, surface outlines, warp grid lines, control points, masks.
export function guideSvg(output, state) {
  const W = output.width, H = output.height;
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const P = p => `${(p.x * W).toFixed(2)},${(p.y * H).toFixed(2)}`;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<title>${esc(output.name)} — ${W}×${H} projection guide</title>`);
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#888" stroke-width="1"/>`);
  for (const s of output.surfaces) {
    if (!s.visible) continue;
    const f = surfaceFn(s);
    const mesh = evalMesh(s, Math.max(state.meshDensity, 48));
    parts.push(`<g id="${esc(s.name)}">`);
    // grid lines through the control rows/cols
    const N = 48;
    const lines = [];
    for (let r = 0; r < s.rows; r++) {
      const v = r / (s.rows - 1);
      lines.push(Array.from({ length: N + 1 }, (_, i) => P(f(i / N, v))).join(' '));
    }
    for (let c = 0; c < s.cols; c++) {
      const u = c / (s.cols - 1);
      lines.push(Array.from({ length: N + 1 }, (_, i) => P(f(u, i / N))).join(' '));
    }
    for (const l of lines) parts.push(`<polyline points="${l}" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="1"/>`);
    // outline
    parts.push(`<polygon points="${outline(mesh).map(P).join(' ')}" fill="none" stroke="#2ee6ff" stroke-width="2"/>`);
    // mask
    if (s.mask && s.mask.enabled && s.mask.pts.length >= 3) {
      const mp = s.mask.pts, pts = [];
      for (let i = 0; i < mp.length; i++) {
        const a = mp[i], b = mp[(i + 1) % mp.length];
        for (let k = 0; k < 8; k++) { const t = k / 8; pts.push(P(f(a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t))); }
      }
      parts.push(`<polygon points="${pts.join(' ')}" fill="none" stroke="#ff6ad5" stroke-width="2" stroke-dasharray="8 5"/>`);
    }
    // control points with row,col labels
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
      const p = s.pts[r][c];
      parts.push(`<circle cx="${(p.x * W).toFixed(2)}" cy="${(p.y * H).toFixed(2)}" r="5" fill="#ffb020" stroke="#000"/>`);
      parts.push(`<text x="${(p.x * W + 8).toFixed(2)}" y="${(p.y * H - 6).toFixed(2)}" font-family="sans-serif" font-size="${Math.max(10, Math.round(H / 72))}" fill="#ffb020">${r},${c}</text>`);
    }
    const l = s.pts[0][0];
    parts.push(`<text x="${(l.x * W + 8).toFixed(2)}" y="${(l.y * H + 18).toFixed(2)}" font-family="sans-serif" font-size="${Math.max(12, Math.round(H / 50))}" fill="#2ee6ff">${esc(s.name)}</text>`);
    parts.push('</g>');
  }
  parts.push(`<text x="12" y="${H - 12}" font-family="sans-serif" font-size="${Math.max(12, Math.round(H / 50))}" fill="#888">${esc(output.name)} · ${W}×${H} · make content at this size and show it with a Full frame surface</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// One matte per visible surface, zipped (store only, no compression: PNGs are already compressed).
export async function surfaceMattesZip(output, state, prefix) {
  const files = [];
  const seen = new Map();
  for (const sf of output.surfaces) {
    if (!sf.visible) continue;
    let name = (sf.name || 'surface').replace(/[^\w.-]+/g, '_');
    const n = (seen.get(name) || 0) + 1; seen.set(name, n); if (n > 1) name += `_${n}`;
    const blob = await silhouettePng(output, state, sf.id);
    files.push({ name: `${prefix}_${name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return zipStore(files);
}
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...u16(20), ...u16(0x800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, f.data);
    central.push(new Uint8Array([0x50, 0x4b, 0x01, 0x02, ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + size;
  }
  const cdStart = offset, cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(cdStart), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
