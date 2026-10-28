// bake.js — offline render worker. tools/bake.js opens bake.html?port=P; this page asks the
// job server for the show and the decoded source frames, renders each frame with the same
// Renderer the projector windows use, and posts the pixels back to be encoded.
import * as C from './core.js';
import { Renderer } from './render.js';

const port = new URLSearchParams(location.search).get('port') || location.port;
const base = `http://127.0.0.1:${port}`;
const status = document.getElementById('status');
const canvas = document.getElementById('c');

class BakeMedia {
  constructor(gl) { this.gl = gl; this.items = new Map(); }
  add(id, w, h) {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.items.set(id, { tex, w, h, ready: false });
  }
  upload(id, buf) {
    const it = this.items.get(id), gl = this.gl;
    if (buf.byteLength !== it.w * it.h * 4) throw new Error(`frame for ${id}: got ${buf.byteLength} bytes, expected ${it.w * it.h * 4}`);
    gl.bindTexture(gl.TEXTURE_2D, it.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, it.w, it.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(buf));
    it.ready = true;
  }
  texture(id) { const it = this.items.get(id); return it && it.ready ? it : null; }
}

function normalize(raw) {
  const s = Object.assign(C.defaultState(), raw);
  s.transport = Object.assign(C.defaultState().transport, raw.transport || {}, { playing: false, pausedAt: 0 });
  for (const o of s.outputs) { C.upgradeOutput(o); for (const sf of o.surfaces) C.upgradeSurface(sf); }
  return s;
}

async function main() {
  const job = await (await fetch(`${base}/job`)).json();
  const state = normalize(job.state);
  const output = state.outputs.find(o => o.id === job.outputId);
  if (!output) throw new Error('output not found: ' + job.outputId);
  const W = output.width, H = output.height;
  canvas.width = W; canvas.height = H;
  const renderer = new Renderer(canvas);
  const gl = renderer.gl;
  if (!gl) throw new Error('no WebGL2 context');
  const media = new BakeMedia(gl);
  for (const m of job.media) media.add(m.id, m.w, m.h);
  const px = new Uint8Array(W * H * 4);
  const frames = job.frames;   // list of frame indices to render (all of them, or a preview selection)
  let n = 0;
  for (const k of frames) {
    for (const m of job.media) {
      if (m.kind === 'image' && media.texture(m.id)) continue;   // stills are fetched once
      const r = await fetch(`${base}/in/${m.id}/${k}`);
      if (!r.ok) throw new Error(`input frame ${k} of ${m.id}: ${r.status} ${await r.text()}`);
      media.upload(m.id, await r.arrayBuffer());
    }
    renderer.render(output, state, media, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);   // rows bottom-up; the encoder flips
    const r = await fetch(`${base}/out/${k}`, { method: 'POST', body: px });
    if (!r.ok) throw new Error(`output frame ${k}: ${r.status} ${await r.text()}`);
    if (++n % 25 === 0) status.textContent = `${n} / ${frames.length}`;
  }
  await fetch(`${base}/done`, { method: 'POST' });
  status.textContent = 'done';
}

main().catch(e => {
  status.textContent = 'failed: ' + (e && e.message || e);
  fetch(`${base}/fail`, { method: 'POST', body: String(e && e.stack || e) });
});
