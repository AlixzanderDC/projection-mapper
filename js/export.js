// export.js — content templates: the exact projected shape at projector resolution.
import { evalMesh, outline, surfaceFn } from './core.js';
import { Renderer } from './render.js';

// White-on-black PNG of everything the projector lights (hard edges, no blend).
export function silhouettePng(output, state) {
  const W = output.width, H = output.height;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const r = new Renderer(canvas);
  const flat = {
    ...output,
    brightness: 1, gamma: 1,
    blend: { left: { w: 0, g: 1 }, right: { w: 0, g: 1 }, top: { w: 0, g: 1 }, bottom: { w: 0, g: 1 } },
    surfaces: output.surfaces.filter(s => s.visible).map(s => ({
      ...s, id: s.id + ':tpl', fill: 'color', color: '#ffffff', opacity: 1,
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
