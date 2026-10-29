#!/usr/bin/env node
// Headless frame renderer for the content pages: opens the page, calls renderAt(t) for every frame,
// streams the raw pixels straight into ffmpeg (no PNGs) from several browser pages in parallel, then
// joins the slices and muxes the audio.
//
//   node content/render-frames.js <page.html> <out.mp4> [preview]
//
//   WORKERS=N          parallel pages (default: half the CPU cores, at least 1, at most 8)
//   PREVIEW_TIMES=a,b  seconds to grab in preview mode (default 3,7,12.5,17,21,25); PNGs land next to <out.mp4>
//   SECONDS=S          render only the first S seconds (quick tests)
//
// Resumable: the slices are written next to the output in <out.mp4>.render/ as fragmented MP4s, which stay
// readable if the render is killed. Run the same command again and it carries on from the frames it has.
//   AUDIO=file         mux this soundtrack (else the page's renderAudio(), if it has one)
//   PLAYWRIGHT_PATH    a node_modules/playwright folder, if Playwright is not installed next to this repo
//   FFMPEG             path to ffmpeg, if not on PATH
//
// The page must expose renderAt(t) drawing into <canvas id="c">, window.DURATION and window.FPS, and may
// expose assetsReady() (fonts/images loaded) and renderAudio() (base64 WAV).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const [,, htmlPath, outMp4, previewOnly] = process.argv;
if (!htmlPath || !outMp4) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 18).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(1); }
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const ROOT = path.resolve(path.dirname(path.resolve(htmlPath)), '..');       // the repo root: ../media/ must resolve
const pageRel = path.relative(ROOT, path.resolve(htmlPath)).split(path.sep).join('/');
const WORKERS = previewOnly ? 1 : Math.max(1, Math.min(8, Number(process.env.WORKERS) || Math.floor(os.cpus().length / 2) || 1));
const outAbs = path.resolve(outMp4);
fs.mkdirSync(path.dirname(outAbs), { recursive: true });
const tmp = previewOnly ? fs.mkdtempSync(path.join(os.tmpdir(), 'render-')) : outAbs + '.render';
fs.mkdirSync(tmp, { recursive: true });
function countFrames(file) {   // frames ffmpeg can actually read back from a (possibly truncated) slice
  const r = spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/i, m => 'ffprobe' + (m.toLowerCase().endsWith('.exe') ? '.exe' : '')), ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const n = parseInt(r.stdout, 10); return r.status === 0 && n > 0 ? n : 0;
}

// ------------------------------------------------------------ static server + frame sink
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const workers = [];   // {id, frames, enc, file, done, w, h}
let failed = null, done = 0, t0 = 0;
let resolveAll, rejectAll; const allDone = new Promise((res, rej) => { resolveAll = res; rejectAll = rej; });
function fail(msg) { if (!failed) { failed = msg; rejectAll(new Error(msg)); } }
function readBody(req) { return new Promise((res, rej) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); }); }
let W = 0, H = 0, FPS = 30, totalFrames = 0;
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    let m;
    if ((m = p.match(/^\/out\/(\d+)\/(\d+)$/)) && req.method === 'POST') {
      const wk = workers[Number(m[1])], k = Number(m[2]);
      const buf = await readBody(req);
      if (buf.length !== W * H * 4) { res.statusCode = 400; return res.end(`expected ${W * H * 4} bytes, got ${buf.length}`); }
      if (previewOnly) {
        const png = path.join(path.dirname(outAbs), `${path.basename(outAbs, path.extname(outAbs))}_${String(k).padStart(6, '0')}.png`);
        const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-nostdin', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', png], { input: buf });
        if (r.status !== 0) throw new Error('png: ' + r.stderr);
      } else {
        await new Promise((ok, bad) => wk.enc.stdin.write(buf, e => e ? bad(e) : ok()));
      }
      done++; if (!t0) t0 = Date.now();
      if (!previewOnly && done % 300 === 0) try { fs.utimesSync(path.join(tmp, 'plan.json'), new Date(), new Date()); } catch {}
      if (done % 100 === 0 || done === totalFrames) { const rate = done / ((Date.now() - t0) / 1000 || 1); console.log(`  ${done} / ${totalFrames} frames  ${rate.toFixed(1)} fps${done < totalFrames ? `  about ${Math.round((totalFrames - done) / rate)} s left` : ''}`); }
      return res.end('ok');
    }
    if ((m = p.match(/^\/done\/(\d+)$/)) && req.method === 'POST') { workers[Number(m[1])].done = true; if (workers.every(w => w.done)) resolveAll(); return res.end('ok'); }
    if (p === '/fail' && req.method === 'POST') { fail('page: ' + (await readBody(req)).toString()); return res.end('ok'); }
    const file = path.join(ROOT, path.normalize(decodeURIComponent(p)).replace(/^([/\\]?\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  } catch (e) { res.statusCode = 500; res.end(String(e && e.message || e)); fail(String(e && e.stack || e)); }
});

// ------------------------------------------------------------ the in-page driver
// Runs inside each page: renders its frames and posts the raw pixels. Works for 2D and WebGL canvases
// (the frame is copied to a 2D canvas in the same task, before the browser can clear it).
const DRIVER = `async ({ base, id, frames, fps }) => {
  const c = document.getElementById('c'); const W = c.width, H = c.height;
  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const g = off.getContext('2d', { willReadFrequently: true });
  for (const k of frames) {
    renderAt(k / fps);
    g.clearRect(0, 0, W, H); g.drawImage(c, 0, 0);
    const px = g.getImageData(0, 0, W, H).data;
    const r = await fetch(base + '/out/' + id + '/' + k, { method: 'POST', body: px });
    if (!r.ok) throw new Error('frame ' + k + ': ' + r.status + ' ' + await r.text());
  }
  await fetch(base + '/done/' + id, { method: 'POST' });
}`;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  let pw; try { pw = require(process.env.PLAYWRIGHT_PATH || 'playwright'); } catch { console.error('Playwright not found: npm install playwright in the repo, or set PLAYWRIGHT_PATH'); process.exit(1); }
  // Edge first on Windows: it is always there and separate from the Chrome the mapper runs in, so closing
  // Chrome windows during a render cannot kill it. BROWSER=chrome|msedge|chromium overrides.
  const launch = { headless: true, args: ['--no-sandbox', '--ignore-gpu-blocklist'] };
  const channels = process.env.BROWSER ? [process.env.BROWSER] : (process.platform === 'win32' ? ['msedge', 'chrome', 'chromium'] : ['chrome', 'chromium']);
  let browser;
  for (const ch of channels) { try { browser = await pw.chromium.launch(ch === 'chromium' ? launch : { ...launch, channel: ch }); console.log('browser:', ch); break; } catch (e) { if (ch === channels[channels.length - 1]) { console.error('could not start a browser: ' + e.message); process.exit(1); } } }
  const url = `${base}/${pageRel}?frame=1`;
  // first page: read the page's size, duration and fps
  const probe = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  probe.on('pageerror', e => fail('page error: ' + e.message));
  await probe.goto(url);
  await probe.waitForFunction(() => !window.assetsReady || window.assetsReady(), null, { timeout: 30000 }).catch(() => console.log('assets not ready after 30 s, rendering anyway'));
  const info = await probe.evaluate(() => { const c = document.getElementById('c'); return { w: c.width, h: c.height, DURATION: window.DURATION, FPS: window.FPS, hasAudio: typeof window.renderAudio === 'function' }; });
  W = info.w; H = info.h; FPS = info.FPS;
  const seconds = process.env.SECONDS ? Math.min(Number(process.env.SECONDS), info.DURATION) : info.DURATION;
  const frames = previewOnly
    ? (process.env.PREVIEW_TIMES ? process.env.PREVIEW_TIMES.split(',').map(Number) : [3, 7, 12.5, 17, 21, 25]).map(t => Math.round(t * FPS))
    : Array.from({ length: Math.round(seconds * FPS) }, (_, i) => i);
  // slice the frames into contiguous runs, one per worker. A plan file pins the slicing so a resumed run
  // (same command again) matches the slices already on disk, whatever WORKERS says now.
  const planFile = path.join(tmp, 'plan.json');
  let plan = null;
  if (!previewOnly && fs.existsSync(planFile)) { try { plan = JSON.parse(fs.readFileSync(planFile, 'utf8')); } catch { plan = null; } }
  if (plan && (plan.w !== W || plan.h !== H || plan.fps !== FPS || plan.total !== frames.length)) { console.log('note: the slices on disk are for a different render; starting afresh'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp); plan = null; }
  if (!plan) {
    const n = previewOnly ? 1 : WORKERS, per = Math.ceil(frames.length / n), slices = [];
    for (let i = 0; i < n; i++) { const mine = frames.slice(i * per, (i + 1) * per); if (mine.length) slices.push([mine[0], mine[mine.length - 1] + 1]); }
    plan = { w: W, h: H, fps: FPS, total: frames.length, slices };
    if (!previewOnly) fs.writeFileSync(planFile, JSON.stringify(plan));
  }
  let already = 0;
  plan.slices.forEach(([a, b], i) => {
    const parts = previewOnly ? [] : fs.readdirSync(tmp).filter(f => new RegExp(`^part${i}(\\.\\d+)?\\.mp4$`).test(f)).sort((x, y) => (parseInt(x.split('.')[1]) || 0) - (parseInt(y.split('.')[1]) || 0)).map(f => path.join(tmp, f));
    let have = 0;
    const kept = [];
    for (const f of parts) { const n = countFrames(f); if (!n) { fs.unlinkSync(f); continue; } have += n; kept.push(f); }
    have = Math.min(have, b - a); already += have;
    const mine = previewOnly ? frames : frames.filter(k => k >= a + have && k < b);
    let enc = null, file = null;
    if (!previewOnly && mine.length) {
      file = path.join(tmp, `part${i}${kept.length ? '.' + kept.length : ''}.mp4`);
      enc = spawn(FFMPEG, ['-y', '-v', 'error', '-nostdin', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-tune', 'zerolatency', '-g', String(FPS), '-keyint_min', String(FPS), '-sc_threshold', '0', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-flush_packets', '1', file], { stdio: ['pipe', 'inherit', 'inherit'] });   // zerolatency: no encoder delay, so each finished second reaches the disk at once (a resume loses under a second per slice)
      enc.on('exit', code => { if (code !== 0) fail(`ffmpeg (worker ${i}) exited with ${code}`); });
      kept.push(file);
    }
    workers.push({ id: i, frames: mine, enc, files: kept, done: !mine.length });
  });
  totalFrames = frames.length - already;
  console.log(`${pageRel}: ${W}×${H} ${FPS} fps, ${previewOnly ? frames.length + ' preview frames' : seconds + ' s, ' + frames.length + ' frames'}, ${plan.slices.length} worker${plan.slices.length > 1 ? 's' : ''}${already ? `, resuming with ${already} frames already done` : ''}`);
  if (!previewOnly && !totalFrames) console.log('all frames were already rendered; joining');
  // run the pages (one per slice that still has frames to render)
  const active = workers.filter(wk => wk.frames.length);
  const pages = [probe];
  for (let i = 1; i < active.length; i++) { const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } }); pg.on('pageerror', e => fail('page error: ' + e.message)); await pg.goto(url); await pg.waitForFunction(() => !window.assetsReady || window.assetsReady(), null, { timeout: 30000 }).catch(() => {}); pages.push(pg); }
  if (active.length) console.log(previewOnly ? 'rendering preview frames…' : 'rendering…');
  const runs = active.map((wk, i) => pages[i].evaluate(`(${DRIVER})(${JSON.stringify({ base, id: wk.id, frames: wk.frames, fps: FPS })})`).catch(e => fail('driver: ' + e.message)));
  let ok = true;
  if (active.length) { try { await Promise.race([allDone, Promise.all(runs).then(() => allDone)]); } catch (e) { ok = false; console.error(e.message); } }
  let audioArgs = [];
  if (ok && !previewOnly) {
    if (process.env.AUDIO) audioArgs = ['-i', path.resolve(process.env.AUDIO), '-c:a', 'aac', '-b:a', '192k', '-shortest'];
    else if (info.hasAudio) { console.log('rendering audio…'); const wav = await probe.evaluate(() => window.renderAudio()); fs.writeFileSync(path.join(tmp, 'audio.wav'), Buffer.from(wav, 'base64')); audioArgs = ['-i', path.join(tmp, 'audio.wav'), '-c:a', 'aac', '-b:a', '192k', '-shortest']; }
  }
  await browser.close(); server.close();
  if (!ok) { await Promise.all(workers.filter(wk => wk.enc).map(wk => new Promise(r => { wk.enc.on('exit', r); wk.enc.stdin.end(); }))); console.error('stopped; run the same command again to resume'); process.exit(1); }
  if (previewOnly) { console.log('preview frames written next to', outMp4); fs.rmSync(tmp, { recursive: true, force: true }); return; }
  await Promise.all(workers.filter(wk => wk.enc).map(wk => new Promise(r => { wk.enc.on('exit', r); wk.enc.stdin.end(); })));
  // join the slices (stream copy) and mux the audio
  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, workers.flatMap(wk => wk.files).map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const r = spawnSync(FFMPEG, ['-y', '-v', 'error', '-nostdin', '-f', 'concat', '-safe', '0', '-i', list, ...audioArgs, '-c:v', 'copy', '-movflags', '+faststart', outAbs], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('join failed'); process.exit(1); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('done', outMp4, (fs.statSync(outAbs).size / 1e6).toFixed(1), 'MB');
})().catch(e => { console.error(e.stack || e); process.exit(1); });
