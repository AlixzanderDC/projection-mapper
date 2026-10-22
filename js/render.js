// render.js — WebGL2 renderer for one output, plus the 2D handle/test-pattern overlay.
import { evalMesh, outline, surfaceFn } from './core.js';

const SURF_VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;
out vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const SURF_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
uniform int uHasTex;
uniform vec4 uRect;      // source crop x, y, w, h
uniform vec4 uFeather;   // l, r, t, b as a fraction of the surface
uniform float uOpacity;
uniform int uMode;       // 0 source, 1 grid, 2 solid color
uniform vec3 uColor;
uniform float uGridDiv;
uniform int uMaskN;      // 0 = no mask
uniform vec2 uMask[32];  // polygon in surface space
uniform float uMaskFeather;
uniform int uMaskInvert;
uniform sampler2D uCut;  // shapes of other surfaces to punch out (screen space)
uniform int uHasCut;
uniform float uCutExpand; // px
uniform vec2 uRes;
out vec4 outColor;
float cutAt(vec2 uv) { return texture(uCut, uv).r; }
float cutAmount() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float cut = cutAt(uv);
  if (uCutExpand > 0.0) {
    vec2 r = uCutExpand / uRes;
    for (int i = 0; i < 8; i++) {
      float an = float(i) * 0.7853982;
      vec2 d = vec2(cos(an), sin(an));
      cut = max(cut, cutAt(uv + d * r));
      cut = max(cut, cutAt(uv + d * r * 0.5));
    }
  }
  return cut;
}
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-12), 0.0, 1.0);
  return length(p - (a + ab * t));
}
float maskAlpha(vec2 p) {
  bool inside = false;
  float d = 1e9;
  for (int i = 0; i < 32; i++) {
    if (i >= uMaskN) break;
    vec2 a = uMask[i];
    vec2 b = uMask[(i + 1 < uMaskN) ? i + 1 : 0];
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    d = min(d, segDist(p, a, b));
  }
  if (uMaskInvert == 1) inside = !inside;
  if (!inside) return 0.0;
  return uMaskFeather > 0.0 ? smoothstep(0.0, uMaskFeather, d) : 1.0;
}
void main() {
  vec3 rgb; float a = 1.0;
  if (uMaskN >= 3) { a = maskAlpha(vUV); if (a <= 0.0) discard; }
  if (uHasCut == 1) { a *= 1.0 - cutAmount(); if (a <= 0.0) discard; }
  if (uMode == 2) {
    rgb = uColor;
  } else if (uMode == 1) {
    vec2 g = vUV * uGridDiv;
    vec2 w = fwidth(g) * 1.5;                       // ~1.5px lines whatever the warp
    vec2 f = abs(fract(g) - 0.5);
    vec2 l = step(0.5 - w, f);
    vec2 edge = step(vUV, w / uGridDiv * 2.0) + step(1.0 - w / uGridDiv * 2.0, vUV);
    float line = max(max(l.x, l.y), max(edge.x, edge.y));
    vec2 cw = fwidth(vUV) * 2.0;
    float cross = max(step(abs(vUV.x - 0.5), cw.x), step(abs(vUV.y - 0.5), cw.y));
    rgb = uColor * max(line, cross);
    a = max(line, cross) > 0.0 ? 1.0 : 0.25;         // faint fill so the surface reads as a shape
  } else if (uHasTex == 1) {
    vec4 c = texture(uTex, uRect.xy + vUV * uRect.zw);
    rgb = c.rgb; a = c.a;
  } else {
    float g = mod(floor(vUV.x * 8.0) + floor(vUV.y * 8.0), 2.0);
    rgb = mix(vec3(0.18), vec3(0.42), g) * vec3(0.7 + 0.3 * vUV.x, 0.7 + 0.3 * vUV.y, 1.0);
  }
  if (uFeather.x > 0.0) a *= smoothstep(0.0, uFeather.x, vUV.x);
  if (uFeather.y > 0.0) a *= smoothstep(0.0, uFeather.y, 1.0 - vUV.x);
  if (uFeather.z > 0.0) a *= smoothstep(0.0, uFeather.z, vUV.y);
  if (uFeather.w > 0.0) a *= smoothstep(0.0, uFeather.w, 1.0 - vUV.y);
  outColor = vec4(rgb, a * uOpacity);
}`;

const MASK_BUF = new Float32Array(64);

const COMP_VS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform vec4 uBlendW;   // left, right, top, bottom in canvas pixels
uniform vec4 uBlendG;   // blend curve gamma per edge
uniform float uBrightness;
uniform float uGamma;
out vec4 outColor;
float ramp(float d, float w, float g) {
  if (w <= 0.0) return 1.0;
  float t = clamp(d / w, 0.0, 1.0);
  return t < 0.5 ? 0.5 * pow(2.0 * t, g) : 1.0 - 0.5 * pow(2.0 * (1.0 - t), g);
}
void main() {
  vec2 px = vUV * uRes;   // px.y counts from the bottom
  float f = ramp(px.x, uBlendW.x, uBlendG.x) * ramp(uRes.x - px.x, uBlendW.y, uBlendG.y)
          * ramp(uRes.y - px.y, uBlendW.z, uBlendG.z) * ramp(px.y, uBlendW.w, uBlendG.w);
  vec3 c = texture(uScene, vUV).rgb * uBrightness;
  c = pow(max(c, vec3(0.0)), vec3(1.0 / uGamma));
  outColor = vec4(c * f, 1.0);
}`;

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl, vs, fs, uniforms) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(prog));
  const u = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
  return { prog, u };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.surf = program(gl, SURF_VS, SURF_FS, ['uTex', 'uHasTex', 'uRect', 'uFeather', 'uOpacity', 'uMode', 'uColor', 'uGridDiv', 'uMaskN', 'uMask', 'uMaskFeather', 'uMaskInvert', 'uCut', 'uHasCut', 'uCutExpand', 'uRes']);
    this.comp = program(gl, COMP_VS, COMP_FS, ['uScene', 'uRes', 'uBlendW', 'uBlendG', 'uBrightness', 'uGamma']);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    this.idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray();

    this.fbo = gl.createFramebuffer();
    this.sceneTex = gl.createTexture();
    this.cutFbo = gl.createFramebuffer();
    this.cutTex = gl.createTexture();
    this.fboW = 0; this.fboH = 0;
  }

  ensureFbo(w, h) {
    if (w === this.fboW && h === this.fboH) return;
    const gl = this.gl;
    for (const [fbo, tex] of [[this.fbo, this.sceneTex], [this.cutFbo, this.cutTex]]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fboW = w; this.fboH = h;
  }

  // Draws one surface with the surface program bound. `cutTex` = screen-space cut mask or null.
  drawSurface(s, state, media, W, H, cutTex, cutExpand, asWhite) {
    const gl = this.gl, u = this.surf.u;
    const mesh = evalMesh(s, state.meshDensity);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.idx, gl.DYNAMIC_DRAW);
    const t = !asWhite && media && s.mediaId ? media.texture(s.mediaId) : null;
    gl.activeTexture(gl.TEXTURE0);
    if (t) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform1i(u.uHasTex, 1);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.uniform1i(u.uHasTex, 0);
    }
    gl.uniform1i(u.uTex, 0);
    gl.uniform4f(u.uRect, s.uv.x, s.uv.y, s.uv.w, s.uv.h);
    gl.uniform4f(u.uFeather, s.feather.l, s.feather.r, s.feather.t, s.feather.b);
    gl.uniform1f(u.uOpacity, asWhite ? 1 : s.opacity);
    const mode = asWhite || s.fill === 'color' ? 2 : s.fill === 'grid' ? 1 : 0;
    const [cr, cg, cb] = asWhite ? [1, 1, 1] : hexToRgb(s.color);
    gl.uniform1i(u.uMode, mode);
    gl.uniform3f(u.uColor, cr, cg, cb);
    gl.uniform1f(u.uGridDiv, Math.max(1, s.gridDiv || 8));
    const mk = s.mask;
    if (mk && mk.enabled && mk.pts.length >= 3) {
      const n = Math.min(32, mk.pts.length);
      for (let i = 0; i < n; i++) { MASK_BUF[i * 2] = mk.pts[i].u; MASK_BUF[i * 2 + 1] = mk.pts[i].v; }
      gl.uniform1i(u.uMaskN, n);
      gl.uniform2fv(u.uMask, MASK_BUF);
      gl.uniform1f(u.uMaskFeather, mk.feather || 0);
      gl.uniform1i(u.uMaskInvert, mk.invert ? 1 : 0);
    } else {
      gl.uniform1i(u.uMaskN, 0);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, cutTex);
    gl.uniform1i(u.uCut, 1);
    gl.uniform1i(u.uHasCut, cutTex ? 1 : 0);
    gl.uniform1f(u.uCutExpand, cutExpand || 0);
    gl.uniform2f(u.uRes, W, H);
    gl.drawElements(gl.TRIANGLES, mesh.idx.length, gl.UNSIGNED_INT, 0);
  }

  // media: object with texture(mediaId) -> {tex} | null, or null for placeholders only.
  render(output, state, media) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    this.ensureFbo(W, H);

    // Pass 1: surfaces into the scene texture.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.surf.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null); // never leave the scene texture bound while drawing into it
    for (const s of output.surfaces) {
      if (!s.visible) continue;
      const cuts = (s.cutouts || []).map(id => output.surfaces.find(x => x.id === id)).filter(x => x && x !== s);
      let cutTex = null;
      if (cuts.length) {
        // Punch-out mask: the cut surfaces drawn white (with their masks and soft edges), hidden or not.
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.cutFbo);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, null);
        for (const c of cuts) this.drawSurface(c, state, null, W, H, null, 0, true);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        cutTex = this.cutTex;
      }
      this.drawSurface(s, state, media, W, H, cutTex, s.cutExpand, false);
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.BLEND);

    // Pass 2: edge blend + brightness/gamma to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.comp.prog);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    const c = this.comp.u, b = output.blend;
    const sx = W / output.width, sy = H / output.height;
    gl.uniform1i(c.uScene, 0);
    gl.uniform2f(c.uRes, W, H);
    gl.uniform4f(c.uBlendW, b.left.w * sx, b.right.w * sx, b.top.w * sy, b.bottom.w * sy);
    gl.uniform4f(c.uBlendG, b.left.g, b.right.g, b.top.g, b.bottom.g);
    gl.uniform1f(c.uBrightness, output.brightness);
    gl.uniform1f(c.uGamma, output.gamma);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

// ---------------------------------------------------------------- overlay (2D canvas, CSS pixels)

export function drawOverlay(ctx, output, state, W, H, opts = {}) {
  const { density = 48, handles = true } = opts;
  ctx.clearRect(0, 0, W, H);
  if (output.testPattern) drawTestPattern(ctx, output, W, H);
  if (!handles) return;
  const sel = state.selection;
  ctx.lineJoin = 'round';
  for (const s of output.surfaces) {
    const mesh = evalMesh(s, density);
    const isSel = sel.surfaceId === s.id;
    const P = i => [mesh.pos[i * 2] * W, mesh.pos[i * 2 + 1] * H];

    // wireframe: a few lines between control points
    const step = Math.max(1, Math.round(mesh.n / Math.max(s.cols - 1, s.rows - 1) / 2));
    ctx.lineWidth = 1;
    ctx.strokeStyle = isSel ? 'rgba(0, 220, 255, 0.35)' : 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    for (let j = 0; j < mesh.ny; j += step) {
      for (let i = 0; i < mesh.nx; i++) { const [x, y] = P(j * mesh.nx + i); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    }
    for (let i = 0; i < mesh.nx; i += step) {
      for (let j = 0; j < mesh.ny; j++) { const [x, y] = P(j * mesh.nx + i); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    }
    ctx.stroke();

    // outline
    const ring = outline(mesh);
    ctx.lineWidth = isSel ? 2 : 1.25;
    ctx.strokeStyle = isSel ? '#2ee6ff' : s.visible ? '#ffb020' : '#777';
    ctx.beginPath();
    ring.forEach((p, i) => (i ? ctx.lineTo(p.x * W, p.y * H) : ctx.moveTo(p.x * W, p.y * H)));
    ctx.closePath();
    ctx.stroke();

    // label
    const l = s.pts[0][0];
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const label = s.name + (s.locked ? ' 🔒' : '');
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(l.x * W + 10, l.y * H - 20, tw + 8, 16);
    ctx.fillStyle = isSel ? '#2ee6ff' : '#fff';
    ctx.fillText(label, l.x * W + 14, l.y * H - 6);

    // mask polygon + handles (selected surface only)
    if (isSel && s.mask && s.mask.enabled && s.mask.pts.length >= 3) {
      const f = surfaceFn(s);
      const mp = s.mask.pts;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ff6ad5';
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < mp.length; i++) {
        const a = mp[i], b = mp[(i + 1) % mp.length];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8, p = f(a.u + (b.u - a.u) * t, a.v + (b.v - a.v) * t);
          (i === 0 && k === 0) ? ctx.moveTo(p.x * W, p.y * H) : ctx.lineTo(p.x * W, p.y * H);
        }
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      mp.forEach((m, i) => {
        const p = f(m.u, m.v), x = p.x * W, y = p.y * H;
        const on = sel.point && sel.point.mask === i;
        ctx.beginPath();
        ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath();
        ctx.fillStyle = on ? '#ffe74c' : '#ff6ad5';
        ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
      });
    }

    // control points
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        const p = s.pts[r][c];
        const corner = (r === 0 || r === s.rows - 1) && (c === 0 || c === s.cols - 1);
        const ptSel = isSel && sel.point && sel.point.r === r && sel.point.c === c;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, ptSel ? 8 : corner ? 6 : 5, 0, Math.PI * 2);
        ctx.fillStyle = ptSel ? '#ffe74c' : corner ? (isSel ? '#2ee6ff' : '#ffb020') : '#ff6ad5';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#000';
        ctx.stroke();
      }
    }
  }
}

function drawTestPattern(ctx, output, W, H) {
  const sx = W / output.width, sy = H / output.height;
  ctx.save();
  ctx.lineWidth = 1;
  for (let x = 0; x <= output.width; x += 100) {
    ctx.strokeStyle = x % 500 === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.moveTo(x * sx + 0.5, 0); ctx.lineTo(x * sx + 0.5, H); ctx.stroke();
  }
  for (let y = 0; y <= output.height; y += 100) {
    ctx.strokeStyle = y % 500 === 0 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)';
    ctx.beginPath(); ctx.moveTo(0, y * sy + 0.5); ctx.lineTo(W, y * sy + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, H); ctx.moveTo(W, 0); ctx.lineTo(0, H); ctx.stroke();
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(Math.min(W, H) / 14)}px system-ui, sans-serif`;
  ctx.fillText(output.name, cx, cy - r - Math.min(W, H) / 16);
  ctx.font = `${Math.round(Math.min(W, H) / 24)}px system-ui, sans-serif`;
  ctx.fillText(`${output.width} × ${output.height}`, cx, cy + r + Math.min(W, H) / 16);
  const cols = ['#f00', '#0f0', '#00f', '#ff0', '#0ff', '#f0f', '#fff', '#888'];
  const bw = W / cols.length, bh = Math.max(8, H / 24);
  cols.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * bw, H - bh - 4, bw, bh); });
  ctx.restore();
}
