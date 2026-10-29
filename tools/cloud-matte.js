#!/usr/bin/env node
// cloud-matte.js — soften a hard matte PNG into a "cloudy" one: the white area fades to black over a ragged,
// noise-driven band inside its edges, so projected content never shows a straight boundary.
//   node tools/cloud-matte.js <in.png> <out.png> [--feather 90] [--rect x,y,w,h] [--seed 7]
// --rect keeps only that rectangle of the matte (also with cloudy edges); use it to vignette a video that is
// smaller than the surface. Needs Playwright with Edge or Chrome (same as render-frames.js).
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const args = process.argv.slice(2), pos = [], opt = { feather: 90, rect: null, seed: 7 };
for (let i = 0; i < args.length; i++) { if (args[i] === '--feather') opt.feather = Number(args[++i]); else if (args[i] === '--rect') opt.rect = args[++i].split(',').map(Number); else if (args[i] === '--seed') opt.seed = Number(args[++i]); else pos.push(args[i]); }
const [inPath, outPath] = pos;
if (!inPath || !outPath) { console.log('usage: node tools/cloud-matte.js <in.png> <out.png> [--feather px] [--rect x,y,w,h] [--seed n]'); process.exit(1); }
const png = fs.readFileSync(inPath);
const server = http.createServer((req, res) => { if (req.url === '/in.png') { res.setHeader('Content-Type', 'image/png'); return res.end(png); } res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><canvas id="c"></canvas>'); });
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
  const launch = { headless: true, args: ['--no-sandbox'] };
  const channels = process.env.BROWSER ? [process.env.BROWSER] : (process.platform === 'win32' ? ['msedge', 'chrome', 'chromium'] : ['chrome', 'chromium']);
  let browser; for (const ch of channels) { try { browser = await pw.chromium.launch(ch === 'chromium' ? launch : { ...launch, channel: ch }); break; } catch (e) { if (ch === channels[channels.length - 1]) { console.error('no browser: ' + e.message); process.exit(1); } } }
  const page = await browser.newPage(); page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  const b64 = await page.evaluate(async ({ feather, rect, seed }) => {
    const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = '/in.png'; });
    const W = img.width, H = img.height, c = document.getElementById('c'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const src = g.getImageData(0, 0, W, H).data;
    // region = white in the matte, and inside the rect if given
    const CELL = 4, GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
    const inside = new Uint8Array(GW * GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const x = Math.min(W - 1, gx * CELL + 2), y = Math.min(H - 1, gy * CELL + 2);
      let ok = src[(y * W + x) * 4] > 128;
      if (ok && rect) ok = x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
      inside[gy * GW + gx] = ok ? 1 : 0;
    }
    // distance (in cells) to the nearest outside cell, by two-pass chamfer
    const INF = 1e9, d = new Float32Array(GW * GH).fill(INF);
    for (let i = 0; i < GW * GH; i++) if (!inside[i]) d[i] = 0;
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) { const i = gy * GW + gx; if (gx) d[i] = Math.min(d[i], d[i - 1] + 1); if (gy) d[i] = Math.min(d[i], d[i - GW] + 1); if (gx && gy) d[i] = Math.min(d[i], d[i - GW - 1] + 1.414); if (gx < GW - 1 && gy) d[i] = Math.min(d[i], d[i - GW + 1] + 1.414); }
    for (let gy = GH - 1; gy >= 0; gy--) for (let gx = GW - 1; gx >= 0; gx--) { const i = gy * GW + gx; if (gx < GW - 1) d[i] = Math.min(d[i], d[i + 1] + 1); if (gy < GH - 1) d[i] = Math.min(d[i], d[i + GW] + 1); if (gx < GW - 1 && gy < GH - 1) d[i] = Math.min(d[i], d[i + GW + 1] + 1.414); if (gx && gy < GH - 1) d[i] = Math.min(d[i], d[i + GW - 1] + 1.414); }
    // value noise for the ragged band
    let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const grid = new Float32Array(64 * 64); for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const sm = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }, lerp = (a, b, t) => a + (b - a) * t;
    const noise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi), v = (a, b) => grid[((b & 63) << 6) | (a & 63)]; return lerp(lerp(v(xi, yi), v(xi + 1, yi), fx), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), fx), fy); };
    const fbm = (x, y) => noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.1;
    const small = document.createElement('canvas'); small.width = GW; small.height = GH;
    const sg = small.getContext('2d'), im = sg.createImageData(GW, GH);
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx, x = gx * CELL, y = gy * CELL;
      const n = 0.55 + 0.9 * fbm(x / 70 + 7, y / 70 + 3);   // 0.55..1.45: the band is ragged but never deeper than 1.45 × feather
      const a = inside[i] ? sm(d[i] * CELL / (feather * n)) : 0;
      const v = Math.round(a * 255); im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255;
    }
    sg.putImageData(im, 0, 0);
    g.imageSmoothingEnabled = true; g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.drawImage(small, 0, 0, W, H);
    return c.toDataURL('image/png').split(',')[1];
  }, opt);
  await browser.close(); server.close();
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(b64, 'base64')); console.log('wrote', outPath);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
