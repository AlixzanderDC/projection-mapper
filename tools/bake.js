#!/usr/bin/env node
// bake.js — render one projector's mapped output to a plain video file, so it can play from a
// USB stick, a media player or Plex with no computer and no mapper at show time.
//
//   node tools/bake.js <show.pmap.json> <output> <out.mp4> [options]
//
//   <output>        the projector: its name, its id, or its number (1 = first in the show)
//   --fps N         frame rate of the file (default 30)
//   --duration S    seconds to render (default: the longest video the output shows)
//   --loops N       repeat the finished file N times (stream copy, instant) so the player restarts rarely
//   --audio FILE    soundtrack to mux, looped to the length (default: the first video on the output that has sound)
//   --audio none    no sound
//   --media DIR     where the source files are (default: <repo>/media; files are matched by name)
//   --preview       render three frames (start, middle, near the end) to PNG next to <out.mp4> instead of a video
//   --crf N         H.264 quality, lower is better (default 18)
//   --show          render in a visible Chrome window (uses the graphics card; headless Chrome may fall back to software rendering)
//
// Needs Node, ffmpeg + ffprobe on PATH (or FFMPEG=/path/to/ffmpeg) and Playwright with Chrome
// (set PLAYWRIGHT_PATH to a node_modules/playwright folder if it is not installed next to this repo).
// The render reuses js/render.js through bake.html, so the file matches the projector window exactly:
// warp, masks, feather, edge blend, brightness, gamma, mounting flip and 360° ball surfaces included.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || (process.env.FFMPEG ? path.join(path.dirname(process.env.FFMPEG), 'ffprobe' + path.extname(process.env.FFMPEG)) : 'ffprobe');

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const opts = { fps: 30, duration: null, loops: 1, audio: null, media: path.join(ROOT, 'media'), preview: false, crf: 18, show: false };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--preview') opts.preview = true;
  else if (a === '--show') opts.show = true;
  else if (a.startsWith('--')) { const k = a.slice(2); if (!(k in opts)) die(`unknown option ${a}`); opts[k] = argv[++i]; }
  else positional.push(a);
}
if (positional.length !== 3) {
  const lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(1);
  console.log(lines.slice(0, lines.findIndex(l => !l.startsWith('//'))).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(positional.length ? 1 : 0);
}
const [showPath, outputSel, outPath] = positional;
opts.fps = Number(opts.fps); opts.loops = Math.max(1, Math.round(Number(opts.loops))); opts.crf = Number(opts.crf);
if (opts.duration != null) opts.duration = Number(opts.duration);
function die(msg) { console.error('bake: ' + msg); process.exit(1); }

// ------------------------------------------------------------------ the show and the output
const show = JSON.parse(fs.readFileSync(showPath, 'utf8'));
if (show.version !== 1 || !Array.isArray(show.outputs)) die('not a show file (expected version 1 with outputs)');
const output = show.outputs.find(o => o.id === outputSel)
  || show.outputs.find(o => (o.name || '').toLowerCase() === outputSel.toLowerCase())
  || (/^\d+$/.test(outputSel) ? show.outputs[Number(outputSel) - 1] : null);
if (!output) die(`no projector "${outputSel}" in the show. Projectors: ${show.outputs.map((o, i) => `${i + 1}: ${o.name} (${o.id})`).join(', ')}`);
const W = output.width, H = output.height;
if (!(W > 0 && H > 0)) die('output has no size');

const usedIds = new Set();
for (const s of output.surfaces) if (s.visible !== false && s.mediaId && s.fill !== 'color') usedIds.add(s.mediaId);
const media = [];
const missing = [];
for (const id of usedIds) {
  const m = show.media.find(x => x.id === id);
  if (!m) { missing.push(id); continue; }
  const candidates = [];
  if (m.url && /^media\//.test(m.url)) candidates.push(path.join(ROOT, decodeURIComponent(m.url)));
  if (m.name) candidates.push(path.join(opts.media, m.name));
  if (m.url && /^media\//.test(m.url)) candidates.push(path.join(opts.media, decodeURIComponent(m.url.slice(6))));
  const file = candidates.find(f => fs.existsSync(f));
  if (!file) { missing.push(m.name || id); continue; }
  media.push({ id, name: m.name, kind: m.kind === 'image' ? 'image' : 'video', file });
}
if (missing.length) die(`source files not found (put them in ${opts.media} or pass --media DIR): ${missing.join(', ')}`);
if (!media.length) console.log('note: this projector shows no media (colour fills or placeholders only); rendering it anyway');

// ------------------------------------------------------------------ probe sources
function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,duration:format=duration', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) die(`ffprobe failed on ${file}: ${r.stderr || r.error}`);
  const j = JSON.parse(r.stdout);
  const v = (j.streams || []).find(s => s.codec_type === 'video');
  const a = (j.streams || []).find(s => s.codec_type === 'audio');
  if (!v) die(`no picture in ${file}`);
  const [num, den] = (v.r_frame_rate || '0/1').split('/').map(Number);
  return { w: v.width, h: v.height, fps: den ? num / den : 0, duration: Number(v.duration || j.format?.duration || 0), audio: !!a };
}
for (const m of media) Object.assign(m, probe(m.file));
const videos = media.filter(m => m.kind === 'video');
let duration = opts.duration;
if (duration == null) {
  duration = videos.length ? Math.max(...videos.map(v => v.duration)) : 10;
  if (!(duration > 0)) die('could not read the video length; pass --duration');
}
const FPS = opts.fps;
const totalFrames = Math.max(1, Math.round(duration * FPS));
duration = totalFrames / FPS;
let audioFile = null;
if (!opts.preview && opts.audio !== 'none') {
  if (opts.audio) { audioFile = path.resolve(opts.audio); if (!fs.existsSync(audioFile)) die(`audio file not found: ${audioFile}`); }
  else { const v = videos.find(v => v.audio); if (v) audioFile = v.file; }
}
const frames = opts.preview ? [0, Math.floor(totalFrames / 2), Math.max(0, totalFrames - Math.round(FPS))].filter((v, i, a) => a.indexOf(v) === i) : Array.from({ length: totalFrames }, (_, i) => i);

console.log(`projector: ${output.name} ${W}×${H}  file: ${FPS} fps, ${duration.toFixed(2)} s, ${totalFrames} frames${opts.loops > 1 ? ` ×${opts.loops} loops` : ''}`);
for (const m of media) console.log(`  source: ${m.name} ${m.w}×${m.h} ${m.kind === 'video' ? `${m.fps.toFixed(2)} fps ${m.duration.toFixed(2)} s${m.audio ? ' +audio' : ''}` : 'still'}`);
console.log(`  audio: ${audioFile ? path.basename(audioFile) : 'none'}`);

// ------------------------------------------------------------------ frame sources (ffmpeg → raw RGBA)
// Sequential reader: one ffmpeg per video, looped and resampled to the output frame rate, so
// frame k of every source lines up with frame k of the file.
class SeqSource {
  constructor(m) {
    this.m = m; this.bytes = m.w * m.h * 4; this.next = 0; this.chunks = []; this.have = 0; this.waiter = null; this.ended = false;
    this.proc = spawn(FFMPEG, ['-v', 'error', '-nostdin', '-stream_loop', '-1', '-i', m.file, '-t', String(duration + 1 / FPS), '-vf', `fps=${FPS}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    this.proc.stdout.on('data', d => { this.chunks.push(d); this.have += d.length; if (this.have >= this.bytes * 2) this.proc.stdout.pause(); this.waiter?.(); });
    this.proc.stdout.on('end', () => { this.ended = true; this.waiter?.(); });
  }
  async get(k) {
    if (k !== this.next) throw new Error(`frames must be read in order (asked ${k}, next is ${this.next})`);
    while (this.have < this.bytes && !this.ended) await new Promise(r => { this.waiter = r; });
    this.waiter = null;
    if (this.have < this.bytes) throw new Error(`${this.m.name}: ffmpeg stopped after ${this.next} frames`);
    const buf = Buffer.concat(this.chunks, this.have);
    const frame = buf.subarray(0, this.bytes);
    const rest = buf.subarray(this.bytes);
    this.chunks = rest.length ? [rest] : []; this.have = rest.length;
    this.proc.stdout.resume();
    this.next++;
    return frame;
  }
  close() { this.proc.kill('SIGKILL'); }
}
// One-shot reader (stills, and preview frames): seek and decode a single frame.
function oneFrame(m, k) {
  const args = ['-v', 'error', '-nostdin'];
  if (m.kind === 'video') args.push('-ss', ((k / FPS) % m.duration).toFixed(4));
  args.push('-i', m.file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1');
  const r = spawnSync(FFMPEG, args, { maxBuffer: m.w * m.h * 4 + (1 << 20) });
  if (r.status !== 0 || r.stdout.length !== m.w * m.h * 4) throw new Error(`${m.name}: could not decode frame ${k} (${r.stderr})`);
  return r.stdout;
}
const sources = new Map();
for (const m of media) sources.set(m.id, m.kind === 'video' && !opts.preview ? new SeqSource(m) : { get: k => Promise.resolve(oneFrame(m, k)), close() {} });

// ------------------------------------------------------------------ encoder (raw RGBA → H.264)
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
const onceFile = opts.loops > 1 ? outPath.replace(/(\.\w+)?$/, '.once$1') : outPath;
let enc = null;
if (!opts.preview) {
  const args = ['-y', '-v', 'error', '-nostdin', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0'];
  if (audioFile) args.push('-stream_loop', '-1', '-i', audioFile, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  args.push('-t', duration.toFixed(4), '-vf', 'vflip,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf), '-profile:v', 'high', '-level', '4.1', '-maxrate', '14M', '-bufsize', '28M',
    '-g', String(FPS * 2), '-keyint_min', String(FPS), '-sc_threshold', '0', '-movflags', '+faststart', onceFile);
  enc = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  enc.on('exit', code => { if (code !== 0 && !finished) fail(`ffmpeg encoder exited with code ${code}`); });
}
function writeFrame(buf) {
  return new Promise((res, rej) => {
    if (!enc.stdin.writable) return rej(new Error('encoder closed'));
    enc.stdin.write(buf, err => err ? rej(err) : res());
  });
}
function writePng(buf, file) {
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-nostdin', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', '-vf', 'vflip', '-frames:v', '1', file], { input: buf });
  if (r.status !== 0) throw new Error('png write failed: ' + r.stderr);
}

// ------------------------------------------------------------------ job server (static files + frames)
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let finished = false, failed = null, done = 0, t0 = 0;
let resolveDone, rejectDone;
const doneP = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });
function fail(msg) { if (!failed) { failed = msg; rejectDone(new Error(msg)); } }
function readBody(req) { return new Promise((res, rej) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); }); }
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/job') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ state: show, outputId: output.id, fps: FPS, frames, media: media.map(m => ({ id: m.id, w: m.w, h: m.h, kind: m.kind })) }));
    }
    let mt;
    if ((mt = p.match(/^\/in\/([^/]+)\/(\d+)$/))) {
      const src = sources.get(decodeURIComponent(mt[1]));
      if (!src) { res.statusCode = 404; return res.end('no such media'); }
      const buf = await src.get(Number(mt[2]));
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.end(buf);
    }
    if ((mt = p.match(/^\/out\/(\d+)$/)) && req.method === 'POST') {
      const k = Number(mt[1]);
      const buf = await readBody(req);
      if (buf.length !== W * H * 4) { res.statusCode = 400; return res.end(`expected ${W * H * 4} bytes, got ${buf.length}`); }
      if (opts.preview) writePng(buf, outPath.replace(/(\.\w+)?$/, `_${String(k).padStart(6, '0')}.png`));
      else await writeFrame(buf);
      done++;
      if (!t0) t0 = Date.now();
      if (done % 100 === 0 || done === frames.length) {
        const rate = done / ((Date.now() - t0) / 1000 || 1);
        console.log(`  ${done} / ${frames.length} frames  ${rate.toFixed(1)} fps  ${done < frames.length ? `about ${Math.round((frames.length - done) / rate)} s left` : ''}`);
      }
      return res.end('ok');
    }
    if (p === '/done' && req.method === 'POST') { finished = true; resolveDone(); return res.end('ok'); }
    if (p === '/fail' && req.method === 'POST') { fail('page: ' + (await readBody(req)).toString()); return res.end('ok'); }
    // static files from the repo (bake.html, js/, css/)
    const file = path.join(ROOT, path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.statusCode = 500; res.end(String(e && e.message || e)); fail(String(e && e.stack || e));
  }
});

// ------------------------------------------------------------------ run
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  let pw;
  try { pw = require(process.env.PLAYWRIGHT_PATH || 'playwright'); }
  catch { die('Playwright not found. Install it next to the repo (npm install playwright) or set PLAYWRIGHT_PATH to a node_modules/playwright folder.'); }
  let browser;
  const launch = { headless: !opts.show, args: ['--no-sandbox', '--ignore-gpu-blocklist'] };
  // Edge first on Windows (always present, separate from the Chrome the mapper runs in); BROWSER=chrome|msedge|chromium overrides.
  const channels = process.env.BROWSER ? [process.env.BROWSER] : (process.platform === 'win32' ? ['msedge', 'chrome', 'chromium'] : ['chrome', 'chromium']);
  for (const ch of channels) { try { browser = await pw.chromium.launch(ch === 'chromium' ? launch : { ...launch, channel: ch }); break; } catch (e) { if (ch === channels[channels.length - 1]) die('could not start a browser: ' + e.message); } }
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => fail('page error: ' + e.message));
  page.on('console', msg => { if (msg.type() === 'error' && !/favicon|404/.test(msg.text())) console.log('  page:', msg.text()); });   // the 404 is Chrome asking for a favicon
  console.log(opts.preview ? 'rendering preview frames…' : 'rendering…');
  await page.goto(`http://127.0.0.1:${port}/bake.html?port=${port}`);
  let ok = true;
  try { await doneP; } catch (e) { ok = false; console.error('bake: ' + e.message); }
  await browser.close();
  for (const s of sources.values()) s.close();
  server.close();
  if (!ok) { if (enc) enc.kill('SIGKILL'); process.exit(1); }
  if (opts.preview) { console.log('preview frames written next to', outPath); return; }
  await new Promise(r => { enc.on('exit', r); enc.stdin.end(); });
  if (opts.loops > 1) {
    console.log(`repeating ×${opts.loops}…`);
    const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-nostdin', '-stream_loop', String(opts.loops - 1), '-i', onceFile, '-c', 'copy', '-movflags', '+faststart', outPath], { stdio: 'inherit' });
    if (r.status !== 0) die('loop copy failed');
    fs.unlinkSync(onceFile);
  }
  const size = fs.statSync(outPath).size;
  const info = probe(outPath);
  console.log(`done: ${outPath}  ${info.w}×${info.h} ${info.fps.toFixed(2)} fps ${(info.duration / 60).toFixed(1)} min  ${(size / 1e9).toFixed(2)} GB`);
  if (size > 4 * 1024 ** 3) console.log('note: over 4 GB — a FAT32 USB stick cannot hold this file; format the stick exFAT or use fewer loops');
})().catch(e => die(e.stack || e));
